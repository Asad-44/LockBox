'use strict';

const express = require('express');
const { createClient } = require('redis');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
require('dotenv').config();

// --- App Initialization ---------------------------------------------------
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Redis Client -----------------------------------------------------------
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('[Redis] Client error:', err.message));

async function connectRedis() {
    await redisClient.connect();
    console.log('[Redis] Connected successfully.');
}

// --- Helpers -----------------------------------------------------------------
function isValidBlob(blob) {
    if (typeof blob !== 'string') return false;
    if (blob.trim().length === 0)  return false;
    if (blob.length > 1_500_000)   return false;
    return true;
}

const VALID_TIMERS = [30, 60, 86400];
const noteKey = (id) => `note:${id}`;

// =============================================================================
// ROUTES
// =============================================================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LockBox API is running.' });
});

// --- POST /api/notes ---------------------------------------------------------
// Stores the encrypted blob in Redis. If expirySeconds is set, Redis handles
// auto-deletion natively via TTL — no manual expiry tracking needed.
// =============================================================================
app.post('/api/notes', async (req, res) => {
    try {
        const { encryptedBlob, isOneTime = true, expirySeconds = null } = req.body;

        if (!isValidBlob(encryptedBlob)) {
            return res.status(400).json({
                error: 'Invalid payload. "encryptedBlob" must be a non-empty string under 1 MB.',
            });
        }

        const noteId = crypto.randomUUID();
        const secondsNum = Number(expirySeconds);
        const ttl = VALID_TIMERS.includes(secondsNum) ? secondsNum : null;

        const payload = JSON.stringify({
            encryptedBlob,
            isOneTime: !!isOneTime,
        });

        if (ttl) {
            // SET with EX — Redis deletes the key automatically when TTL hits 0
            await redisClient.set(noteKey(noteId), payload, { EX: ttl });
        } else {
            // No timer — persists until burned or manually cleared
            await redisClient.set(noteKey(noteId), payload);
        }

        console.log(`[API] Note created: ${noteId}${ttl ? ` (TTL ${ttl}s)` : ''}`);
        return res.status(201).json({ noteId });

    } catch (err) {
        console.error('[API] POST /api/notes error:', err.message);
        return res.status(500).json({ error: 'Internal server error. Could not save note.' });
    }
});

// --- GET /api/notes/:id -------------------------------------------------------
// Fetches the encrypted blob. Burn-on-read notes are deleted immediately after
// being read. Timer-based notes rely on Redis TTL for expiry, and we report
// the live remaining TTL back to the client so refreshes show the correct time.
// =============================================================================
app.get('/api/notes/:id', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');

        const { id } = req.params;

        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!guidRegex.test(id)) {
            return res.status(400).json({ error: 'Invalid Note ID format.' });
        }

        const key = noteKey(id);

        // Read the TTL and value together. TTL of -2 means the key doesn't
        // exist (never created, already burned, or already expired) — Redis
        // doesn't distinguish these after the fact, so we report one message.
        const [ttl, raw] = await Promise.all([
            redisClient.ttl(key),
            redisClient.get(key),
        ]);

        if (raw === null) {
            return res.status(404).json({
                error: 'Note not found. It may have expired, already been viewed, or never existed.',
            });
        }

        const note = JSON.parse(raw);

        // --- Burn-on-Read Logic ---
        if (note.isOneTime) {
            await redisClient.del(key);
            console.log(`[API] Note burned (one-time read): ${id}`);
        } else {
            console.log(`[API] Note fetched (persistent): ${id}`);
        }

        // ttl > 0 means a real expiry is active; -1 means no TTL (persistent)
        const remainingSeconds = ttl > 0 ? ttl : null;

        return res.status(200).json({
            encryptedBlob: note.encryptedBlob,
            isOneTime: note.isOneTime,
            remainingSeconds,
        });

    } catch (err) {
        console.error('[API] GET /api/notes/:id error:', err.message);
        return res.status(500).json({ error: 'Internal server error. Could not retrieve note.' });
    }
});

// --- 404 Handler for unknown API routes ------------------------------------
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
});

// --- Catch-all: serve index.html for non-API routes (SPA support) ----------
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// SERVER STARTUP
// =============================================================================
async function startServer() {
    try {
        await connectRedis();
        app.listen(PORT, () => {
            console.log(`\n🔒 LockBox server running at http://localhost:${PORT}`);
            console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
        });
    } catch (err) {
        console.error('[FATAL] Could not connect to Redis:', err.message);
        console.error('        Check REDIS_URL in .env and ensure Redis is running.');
        process.exit(1);
    }
}

startServer();