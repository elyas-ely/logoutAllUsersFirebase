const express = require('express');
const { forceLogoutAllUsers, initializeFirebase } = require('./forceLogoutUsers');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// ==========================================
// 🔒 SAFETY CONFIGURATION
// ==========================================

// ⚠️ ENABLE THIS ONLY WHEN YOU WANT TO RUN THE LOGOUT PROCESS
// Change this to true to enable the logout endpoint
const LOGOUT_ENABLED = false;

// Secret key for simple authentication (optional but recommended)
// Pass this as a query param ?key=YOUR_SECRET_KEY or header x-api-key
const API_SECRET = process.env.API_SECRET || 'changeme';

// ==========================================

// Initialize Firebase on server start
try {
    initializeFirebase();
    console.log('✅ Firebase initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    console.error('Server will start but logout functions may fail');
}

// Basic health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Firebase Logout Service',
        logoutEnabled: LOGOUT_ENABLED
    });
});

// The Force Logout Endpoint
app.post('/force-logout', async (req, res) => {
    // 1. Security Check: Feature Flag
    if (!LOGOUT_ENABLED) {
        console.log('🛑 Blocked attempt to call /force-logout (feature disabled)');
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Logout functionality is currently DISABLED by default. Please enable it in server.js to use this feature.'
        });
    }

    // 2. Security Check: API Key (Simple auth)
    const providedKey = req.query.key || req.headers['x-api-key'];
    if (API_SECRET !== 'changeme' && providedKey !== API_SECRET) {
        console.log('🛑 Blocked attempt to call /force-logout (invalid key)');
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
    }

    // 3. Configuration
    const immediateMode = req.body.immediate === true || req.query.immediate === 'true';

    // Load excluded users
    let excludedUserIds = [];
    const configPath = path.join(__dirname, 'config.js');
    if (fs.existsSync(configPath)) {
        try {
            const config = require('./config');
            excludedUserIds = config.excludedUserIds || [];
        } catch (e) {
            console.error('Error loading config:', e);
        }
    }

    console.log(`\n🚀 Received logout request from ${req.ip}`);
    console.log(`   Mode: ${immediateMode ? 'IMMEDIATE (terminate sessions)' : 'Revoke tokens only'}`);
    console.log(`   Excluded IDs: ${excludedUserIds.length}`);

    try {
        // 4. Execution
        // Run asynchronously and return ID, or await and return result?
        // For 20k users, this might take a while, so we'll run it and stream logs or just return "started"

        // Option A: Wait for completion (might timeout for very large user bases)
        console.log('⏳ Starting logout process...');
        const result = await forceLogoutAllUsers(excludedUserIds, immediateMode);

        console.log('✅ Logout process completed locally');
        return res.json({
            status: 'success',
            message: 'Logout process completed',
            details: result
        });

    } catch (error) {
        console.error('❌ Logout process failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Internal server error during logout process',
            error: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`👉 Health check: http://localhost:${PORT}/`);
    console.log(`👉 Logout endpoint: http://localhost:${PORT}/force-logout`);
    console.log(`🔒 Safety Lock: ${LOGOUT_ENABLED ? '🔴 UNLOCKED (Enabled)' : '🟢 LOCKED (Disabled)'}`);

    if (!LOGOUT_ENABLED) {
        console.log('\nTo enable logout functionality:');
        console.log('1. Open server.js');
        console.log('2. Change LOGOUT_ENABLED to true');
        console.log('3. Restart the server');
    }
});
