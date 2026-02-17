const { initializeFirebase } = require('./forceLogoutUsers');
const admin = require('firebase-admin');

/**
 * Test script to logout a single user
 * This is useful for testing before running the full batch logout
 */
async function testSingleUserLogout(userId) {
    if (!userId) {
        console.error('❌ Error: User ID is required');
        console.log('\nUsage: node testSingleUser.js <user-id>');
        console.log('Example: node testSingleUser.js abc123xyz456');
        process.exit(1);
    }

    console.log('=== Testing Single User Logout ===\n');
    console.log(`Target User ID: ${userId}`);

    try {
        // Initialize Firebase
        initializeFirebase();
        console.log('✅ Firebase initialized successfully\n');

        // First, fetch user details
        console.log('Fetching user details...');
        let userRecord;
        try {
            userRecord = await admin.auth().getUser(userId);
            console.log('✅ User found:');
            console.log(`   - UID: ${userRecord.uid}`);
            console.log(`   - Email: ${userRecord.email || 'N/A'}`);
            console.log(`   - Display Name: ${userRecord.displayName || 'N/A'}`);
            console.log(`   - Created: ${new Date(userRecord.metadata.creationTime).toLocaleString()}`);
            console.log(`   - Last Sign In: ${userRecord.metadata.lastSignInTime ? new Date(userRecord.metadata.lastSignInTime).toLocaleString() : 'Never'}`);
            console.log(`   - Tokens Valid After: ${new Date(userRecord.tokensValidAfterTime).toLocaleString()}\n`);
        } catch (error) {
            console.error(`❌ Failed to fetch user: ${error.message}`);
            process.exit(1);
        }

        // Ask for confirmation
        console.log('⚠️  WARNING: This will revoke all refresh tokens for this user.');
        console.log('The user will be forced to login again on their next request.\n');

        // Revoke refresh tokens
        console.log('Revoking refresh tokens...');
        const beforeRevoke = new Date();

        await admin.auth().revokeRefreshTokens(userId);

        console.log('✅ Tokens revoked successfully!\n');

        // Verify the revocation
        console.log('Verifying revocation...');
        const updatedUser = await admin.auth().getUser(userId);
        const afterRevoke = new Date(updatedUser.tokensValidAfterTime);

        console.log(`   - New Tokens Valid After: ${afterRevoke.toLocaleString()}`);
        console.log(`   - Revocation Time: ${beforeRevoke.toLocaleString()}\n`);

        const timeDiff = Math.abs(afterRevoke - beforeRevoke);
        if (timeDiff < 5000) { // Within 5 seconds means success
            console.log('✅ SUCCESS: Tokens successfully revoked!');
            console.log('   The user is now LOGGED OUT and will be forced to re-authenticate.');
            console.log('   Note: Active sessions may continue until the access token expires,');
            console.log('   but any new requests requiring token refresh will fail.\n');
        } else {
            console.log('⚠️  WARNING: Token revocation may not have worked as expected.');
            console.log(`   Time difference: ${timeDiff}ms\n`);
        }

        console.log('\n=== Test Complete ===');
        console.log('If this test was successful, you can now run the full batch logout:');
        console.log('   npm start\n');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
    }
}

// Get user ID from command line argument or use hardcoded value
const userId = process.argv[2] || '4C5TKE0NXLSnUpdIswq1WNLGXsM2';

// Run the test
testSingleUserLogout(userId).then(() => {
    console.log('✅ Test completed successfully');
    process.exit(0);
}).catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
