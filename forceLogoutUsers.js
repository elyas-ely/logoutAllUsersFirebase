const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');

/**
 * Force logout all users except those in the exclusion list
 * Uses a sliding window concurrency model for maximum throughput
 * Handles rate limiting for "immediate" logout (updateUser quota is strict)
 * @param {string[]} excludedUserIds - Array of user IDs to exclude from logout
 * @param {boolean} immediateLogout - If true, terminates active sessions by disabling/re-enabling accounts
 * @returns {Promise<{success: number, failed: number, skipped: number, errors: Array}>}
 */
async function forceLogoutAllUsers(excludedUserIds = [], immediateLogout = false) {
    const excludedSet = new Set(excludedUserIds);
    let nextPageToken;
    let totalProcessed = 0;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const errors = [];

    // DYNAMIC CONCURRENCY
    // Immediate mode uses admin.auth().updateUser() which has stricter rate limits (approx 10-20/sec)
    // Standard mode uses admin.auth().revokeRefreshTokens() which handles higher throughput but quota is shared
    // User requested concurrency 10
    const concurrency = immediateLogout ? 5 : 10;
    const limit = pLimit(concurrency);
    const allPromises = [];

    console.log(`Starting optimized parallel logout process...`);
    console.log(`Excluded users: ${excludedUserIds.length}`);
    console.log(`Immediate logout mode: ${immediateLogout ? 'ENABLED (terminates active sessions)' : 'DISABLED (revoke tokens only)'}`);
    console.log(`Concurrency Limit: ${concurrency} operations/sec (adjusted for rate limits)\n`);

    try {
        do {
            // Fetch users in batches of 1000
            const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);

            console.log(`Fetched batch of ${listUsersResult.users.length} users. Queuing for parallel processing...`);

            // Queue each user for processing
            const batchPromises = listUsersResult.users.map(userRecord => {
                return limit(async () => {
                    totalProcessed++;

                    // Skip excluded users
                    if (excludedSet.has(userRecord.uid)) {
                        skippedCount++;
                        console.log(`Skipped user: ${userRecord.uid} (excluded)`);
                        return { status: 'skipped', uid: userRecord.uid };
                    }

                    try {
                        if (immediateLogout) {
                            // RETRY LOGIC for quota enforcement
                            await robustUpdateUser(userRecord.uid, { disabled: true });

                            // Revoke refresh tokens
                            await admin.auth().revokeRefreshTokens(userRecord.uid);

                            // Re-enable account
                            await robustUpdateUser(userRecord.uid, { disabled: false });
                        } else {
                            // Just revoke refresh tokens
                            // Add small delay to respect 10qps limit strictly
                            await new Promise(resolve => setTimeout(resolve, 100));
                            await admin.auth().revokeRefreshTokens(userRecord.uid);
                        }

                        successCount++;
                        // Log every 10 successes (immediate) or 100 (standard) to track progress better
                        const logInterval = immediateLogout ? 10 : 100;
                        if (successCount % logInterval === 0) {
                            console.log(`Progress: ${successCount} users logged out...`);
                        }
                        return { status: 'success', uid: userRecord.uid };
                    } catch (error) {
                        failedCount++;
                        const errorInfo = {
                            uid: userRecord.uid,
                            email: userRecord.email,
                            error: error.message
                        };
                        errors.push(errorInfo);
                        // Only log errors if not quota related (to avoid spam if we hit limits despite throttling)
                        if (!error.message.includes('quota')) {
                            console.error(`Failed to logout user ${userRecord.uid}:`, error.message);
                        } else {
                            console.error(`Quota exceeded for user ${userRecord.uid} - skipping`);
                        }
                        return { status: 'failed', uid: userRecord.uid, error: error.message };
                    }
                });
            });

            // Add batch promises to the main list
            allPromises.push(...batchPromises);

            // Move to next page immediately
            nextPageToken = listUsersResult.pageToken;

        } while (nextPageToken);

        console.log('\nAll users queued. Waiting for completion...');

        // Wait for all operations to complete
        await Promise.all(allPromises);

        console.log('\n=== Logout Process Complete ===');
        console.log(`Total processed: ${totalProcessed}`);
        console.log(`Successfully logged out: ${successCount}`);
        console.log(`Failed: ${failedCount}`);
        console.log(`Skipped (excluded): ${skippedCount}`);

        return {
            success: successCount,
            failed: failedCount,
            skipped: skippedCount,
            total: totalProcessed,
            errors: errors
        };

    } catch (error) {
        console.error('Fatal error during logout process:', error);
        throw error;
    }
}

/**
 * Helper to retry updateUser on failure (simple improved reliability)
 */
async function robustUpdateUser(uid, properties, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await admin.auth().updateUser(uid, properties);
            return;
        } catch (error) {
            if (i === retries - 1) throw error; // Last retry failed

            // Wait before retry (exponential backoff: 500ms, 1000ms, 2000ms)
            const delay = 500 * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Initialize Firebase Admin SDK (if not already initialized)
 */
function initializeFirebase() {
    if (!admin.apps.length) {
        // Try to find service account key
        const serviceAccountPath = path.join(__dirname, 'service.json');

        if (fs.existsSync(serviceAccountPath)) {
            const serviceAccount = require(serviceAccountPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase Admin initialized with service account key');
        } else {
            // Fallback methods...
            admin.initializeApp({
                credential: admin.credential.applicationDefault()
            });
            console.log('Firebase Admin initialized with application default credentials');
        }
    }
}

// Example usage
async function main() {
    try {
        initializeFirebase();

        // Load excluded user IDs
        let excludedUserIds = [];
        const configPath = path.join(__dirname, 'config.js');
        if (fs.existsSync(configPath)) {
            const config = require('./config');
            excludedUserIds = config.excludedUserIds || [];
            console.log(`Loaded ${excludedUserIds.length} excluded IDs from config.js`);
        }

        const immediateMode = process.argv.includes('--immediate');

        console.log('\n⚠️  WARNING: This will logout ALL users except those in the exclusion list!');
        console.log(`Excluded IDs: ${excludedUserIds.length} users`);
        console.log(`Immediate logout: ${immediateMode ? 'YES (terminates active sessions)' : 'NO (revoke tokens only)'}`);
        console.log('\nStarting in 3 seconds...\n');

        await new Promise(resolve => setTimeout(resolve, 3000));

        const result = await forceLogoutAllUsers(excludedUserIds, immediateMode);

        console.log('\n=== Final Results Summary ===');
        console.log(`Success: ${result.success}`);
        console.log(`Failed: ${result.failed}`);

        if (result.failed > 0) {
            console.log(`See logs for details on failures.`);
            // Write errors to a file for better debugging
            const errorLogPath = path.join(__dirname, 'logout_errors.json');
            fs.writeFileSync(errorLogPath, JSON.stringify(result.errors, null, 2));
            console.log(`Detailed errors saved to: ${errorLogPath}`);
        }

    } catch (error) {
        console.error('Error in main execution:', error);
        process.exit(1);
    }
}

module.exports = {
    forceLogoutAllUsers,
    initializeFirebase
};

if (require.main === module) {
    main().then(() => {
        console.log('\n✅ Process completed successfully');
        process.exit(0);
    }).catch((error) => {
        console.error('\n❌ Process failed:', error);
        process.exit(1);
    });
}
