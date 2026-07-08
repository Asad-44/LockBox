'use strict';

const express = require('express');
const multer  = require('multer');
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

// Multer stores the uploaded file in memory as a Buffer (req.file.buffer) —
// we never write it to disk, keeping the zero-knowledge server model intact.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024 }, // 6MB raw cap (encrypted blob is slightly larger than original file)
});

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
// Handles BOTH:
//   - JSON body for text notes  (Content-Type: application/json)
//   - multipart/form-data for files (Content-Type: multipart/form-data)
// `upload.single('file')` only parses the body if it's actually multipart;
// for JSON requests it's a no-op and req.body/express.json() still applies.
// =============================================================================
app.post('/api/notes', upload.single('file'), async (req, res) => {
    try {
        const isFile = req.body.isFile === 'true' || req.body.isFile === true;

        const noteId = crypto.randomUUID();
        const isOneTime = req.body.isOneTime === 'true' || req.body.isOneTime === true;
        const secondsNum = Number(req.body.expirySeconds);
        const ttl = VALID_TIMERS.includes(secondsNum) ? secondsNum : null;

        let payload;

        if (isFile) {
            // --- File branch: req.file.buffer holds the encrypted Blob's bytes ---
            if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
                return res.status(400).json({ error: 'No file received.' });
            }
            if (req.file.buffer.length > 6 * 1024 * 1024) {
                return res.status(400).json({ error: 'File too large. Maximum size is 5 MB.' });
            }

            payload = JSON.stringify({
                type: 'file',
                fileName: req.body.fileName || 'downloaded_file',
                isOneTime,
                // Store binary as base64 inside the JSON payload for simplicity
                data: req.file.buffer.toString('base64'),
            });

        } else {
            // --- Note branch: JSON body ---
            const { encryptedBlob } = req.body;

            if (!isValidBlob(encryptedBlob)) {
                return res.status(400).json({
                    error: 'Invalid payload. "encryptedBlob" must be a non-empty string under 1 MB.',
                });
            }

            payload = JSON.stringify({
                type: 'note',
                isOneTime,
                encryptedBlob,
            });
        }

        if (ttl) {
            await redisClient.set(noteKey(noteId), payload, { EX: ttl });
        } else {
            await redisClient.set(noteKey(noteId), payload);
        }

        console.log(`[API] ${isFile ? 'File' : 'Note'} created: ${noteId}${ttl ? ` (TTL ${ttl}s)` : ''}`);
        return res.status(201).json({ noteId });

    } catch (err) {
        console.error('[API] POST /api/notes error:', err.message);
        return res.status(500).json({ error: 'Internal server error. Could not save note.' });
    }
});

// --- GET /api/notes/:id -------------------------------------------------------
// Branches response format based on stored type:
//   - note → JSON { encryptedBlob, isOneTime, remainingSeconds }
//   - file → raw binary body + X-File-Name / X-Is-One-Time / X-Remaining-Seconds headers
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

        if (note.isOneTime) {
            await redisClient.del(key);
            console.log(`[API] ${note.type} burned (one-time read): ${id}`);
        } else {
            console.log(`[API] ${note.type} fetched (persistent): ${id}`);
        }

        const remainingSeconds = ttl > 0 ? ttl : null;

        if (note.type === 'file') {
            const buffer = Buffer.from(note.data, 'base64');
            res.set('Content-Type', 'application/octet-stream');
            res.set('X-File-Name', encodeURIComponent(note.fileName));
            res.set('X-Is-One-Time', String(note.isOneTime));
            if (remainingSeconds !== null) res.set('X-Remaining-Seconds', String(remainingSeconds));
            return res.status(200).send(buffer);
        }

        // Text note
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