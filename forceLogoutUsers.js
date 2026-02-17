const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const pLimit = require('p-limit');

/**
 * Force logout all users except those in the exclusion list
 * Uses a sliding window concurrency model for maximum throughput
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

    // Concurrency limit: 50 concurrent operations
    // This pipeline keeps 50 operations active at all times, avoiding "batch wait" delays
    const limit = pLimit(50);
    const allPromises = [];

    console.log(`Starting optimized parallel logout process...`);
    console.log(`Excluded users: ${excludedUserIds.length}`);
    console.log(`Immediate logout mode: ${immediateLogout ? 'ENABLED (terminates active sessions)' : 'DISABLED (revoke tokens only)'}\n`);

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
                            // Disable account (terminates all active sessions)
                            await admin.auth().updateUser(userRecord.uid, { disabled: true });
                            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

                            // Revoke refresh tokens
                            await admin.auth().revokeRefreshTokens(userRecord.uid);

                            // Re-enable account
                            await admin.auth().updateUser(userRecord.uid, { disabled: false });
                        } else {
                            // Just revoke refresh tokens
                            await admin.auth().revokeRefreshTokens(userRecord.uid);
                        }

                        successCount++;
                        // Log every 100 successes to avoid spamming console
                        if (successCount % 100 === 0) {
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
                        console.error(`Failed to logout user ${userRecord.uid}:`, error.message);
                        return { status: 'failed', uid: userRecord.uid, error: error.message };
                    }
                });
            });

            // Add batch promises to the main list
            allPromises.push(...batchPromises);

            // Move to next page immediately (don't wait for processing to finish)
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

        console.log('\n=== Final Results ===');
        // Only log summary, not full JSON if huge
        console.log(JSON.stringify({
            success: result.success,
            failed: result.failed,
            skipped: result.skipped,
            total: result.total,
            errorCount: result.errors.length
        }, null, 2));

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
