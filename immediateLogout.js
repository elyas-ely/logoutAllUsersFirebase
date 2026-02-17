const { initializeFirebase } = require('./forceLogoutUsers');
const admin = require('firebase-admin');

/**
 * Immediately logout a user by disabling their account, revoking tokens, and re-enabling
 * This terminates ALL active sessions immediately
 */
async function immediateLogout(userId) {
    if (!userId) {
        console.error('❌ Error: User ID is required');
        console.log('\nUsage: node immediateLogout.js <user-id>');
        console.log('Example: node immediateLogout.js abc123xyz456');
        process.exit(1);
    }

    console.log('=== Immediate User Logout ===\n');
    console.log(`Target User ID: ${userId}`);

    try {
        // Initialize Firebase
        initializeFirebase();
        console.log('✅ Firebase initialized successfully\n');

        // Fetch user details
        console.log('Fetching user details...');
        let userRecord;
        try {
            userRecord = await admin.auth().getUser(userId);
            console.log('✅ User found:');
            console.log(`   - UID: ${userRecord.uid}`);
            console.log(`   - Email: ${userRecord.email || 'N/A'}`);
            console.log(`   - Display Name: ${userRecord.displayName || 'N/A'}`);
            console.log(`   - Disabled: ${userRecord.disabled}`);
            console.log(`   - Last Sign In: ${userRecord.metadata.lastSignInTime ? new Date(userRecord.metadata.lastSignInTime).toLocaleString() : 'Never'}\n`);
        } catch (error) {
            console.error(`❌ Failed to fetch user: ${error.message}`);
            process.exit(1);
        }

        // Warning
        console.log('⚠️  WARNING: This will IMMEDIATELY terminate all active sessions!');
        console.log('The process will:');
        console.log('   1. Disable the user account (terminates all sessions)');
        console.log('   2. Revoke all refresh tokens');
        console.log('   3. Re-enable the user account');
        console.log('\nProceeding in 3 seconds...\n');

        // Wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Step 1: Disable the user
        console.log('Step 1/3: Disabling user account...');
        await admin.auth().updateUser(userId, {
            disabled: true
        });
        console.log('✅ User account disabled (all sessions terminated)\n');

        // Small delay to ensure the disable takes effect
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 2: Revoke refresh tokens
        console.log('Step 2/3: Revoking refresh tokens...');
        await admin.auth().revokeRefreshTokens(userId);
        console.log('✅ Refresh tokens revoked\n');

        // Step 3: Re-enable the user
        console.log('Step 3/3: Re-enabling user account...');
        await admin.auth().updateUser(userId, {
            disabled: false
        });
        console.log('✅ User account re-enabled\n');

        // Verify
        console.log('Verifying final state...');
        const updatedUser = await admin.auth().getUser(userId);
        console.log(`   - Disabled: ${updatedUser.disabled}`);
        console.log(`   - Tokens Valid After: ${new Date(updatedUser.tokensValidAfterTime).toLocaleString()}\n`);

        console.log('✅ SUCCESS: User has been immediately logged out!');
        console.log('   - All active sessions have been terminated');
        console.log('   - All refresh tokens have been revoked');
        console.log('   - User account is active and can log in again\n');

        console.log('=== Immediate Logout Complete ===\n');

    } catch (error) {
        console.error('\n❌ Immediate logout failed:', error.message);
        console.error('\nFull error:', error);

        // Try to re-enable the user if something went wrong
        console.log('\nAttempting to re-enable user account...');
        try {
            await admin.auth().updateUser(userId, { disabled: false });
            console.log('✅ User account re-enabled');
        } catch (reEnableError) {
            console.error('❌ Failed to re-enable user:', reEnableError.message);
        }

        process.exit(1);
    }
}

// Get user ID from command line argument or use hardcoded value
const userId = process.argv[2] || '4C5TKE0NXLSnUpdIswq1WNLGXsM2';

// Run the immediate logout
immediateLogout(userId).then(() => {
    console.log('✅ Process completed successfully');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Process failed:', error);
    process.exit(1);
});
