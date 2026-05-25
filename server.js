'use strict';

const express = require('express');
const mssql   = require('mssql');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

// --- App Initialization ---------------------------------------------------
const app  = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());                          // Allow cross-origin requests (dev)
app.use(express.json({ limit: '2mb' })); // Parse JSON bodies (limit blob size)
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend files

// --- Database Configuration -----------------------------------------------
// Reads connection params from the .env file (never hardcode credentials).
const dbConfig = {
    server:   process.env.DB_SERVER   || 'localhost',
    database: process.env.DB_NAME     || 'LockBoxDB',
    options: {
        // Use the instance name if provided (e.g., SQLEXPRESS)
        instanceName:       process.env.DB_INSTANCE || undefined,
        // Trusted connection uses Windows Auth; set to false for SQL Auth
        trustedConnection:  process.env.DB_TRUSTED_CONNECTION === 'true',
        trustServerCertificate: true, // Required for local/dev SQL Server
        enableArithAbort:   true,
    },
    // Only used when trustedConnection is false
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Connection pool settings
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
    },
};

// --- Database Connection Pool ---------------------------------------------
// We create a single pool and reuse it across all requests for efficiency.
let pool;

async function getPool() {
    if (!pool) {
        pool = await mssql.connect(dbConfig);
        console.log('[DB] Connected to SQL Server successfully.');
    }
    return pool;
}

// --- Helper: Input Validation ---------------------------------------------
/**
 * Validates that the encrypted blob string is non-empty and within a
 * safe size limit to prevent abuse / oversized payloads.
 */
function isValidBlob(blob) {
    if (typeof blob !== 'string') return false;
    if (blob.trim().length === 0)  return false;
    if (blob.length > 1_500_000)   return false; // ~1 MB of base64 ciphertext
    return true;
}

// =============================================================================
// ROUTES
// =============================================================================

// --- Health Check -----------------------------------------------------------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LockBox API is running.' });
});

// --- POST /api/notes --------------------------------------------------------
// Receives an AES-encrypted blob from the client and stores it.
// Returns the auto-generated NoteID (GUID) used to build the share link.
//
// Request body:
//   { "encryptedBlob": "<CryptoJS AES ciphertext string>", "isOneTime": true }
//
// Response:
//   { "noteId": "<GUID>" }
// =============================================================================
app.post('/api/notes', async (req, res) => {
    try {
        const { encryptedBlob, isOneTime = true } = req.body;

        // --- Input Validation ---
        if (!isValidBlob(encryptedBlob)) {
            return res.status(400).json({
                error: 'Invalid payload. "encryptedBlob" must be a non-empty string under 1 MB.',
            });
        }

        const oneTimeBit = isOneTime ? 1 : 0;

        // --- Parameterized INSERT (prevents SQL Injection) ---
        const db     = await getPool();
        const result = await db.request()
            // Using named parameters — mssql binds these safely as prepared values
            .input('encryptedBlob', mssql.NVarChar(mssql.MAX), encryptedBlob)
            .input('isOneTime',     mssql.Bit,                  oneTimeBit)
            .query(`
                INSERT INTO dbo.SecretNotes (EncryptedBlob, IsOneTime)
                OUTPUT INSERTED.NoteID
                VALUES (@encryptedBlob, @isOneTime)
            `);

        const noteId = result.recordset[0].NoteID;
        console.log(`[API] Note created: ${noteId}`);

        return res.status(201).json({ noteId });

    } catch (err) {
        console.error('[API] POST /api/notes error:', err.message);
        return res.status(500).json({ error: 'Internal server error. Could not save note.' });
    }
});

// --- GET /api/notes/:id -----------------------------------------------------
// Fetches the encrypted blob for a given NoteID.
//
// BURN-ON-READ:
//   If the note's IsOneTime flag is set, the note is DELETED from the database
//   BEFORE the response is sent. This ensures one-time access only.
//   The server only ever returns the encrypted blob — it has no ability to
//   decrypt it without the key, which it never receives.
//
// Response:
//   { "encryptedBlob": "<ciphertext>", "isOneTime": true }
// =============================================================================
app.get('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // --- Basic GUID format validation (prevents obviously bad queries) ---
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!guidRegex.test(id)) {
            return res.status(400).json({ error: 'Invalid Note ID format.' });
        }

        const db = await getPool();

        // --- Parameterized SELECT ---
        const result = await db.request()
            .input('noteId', mssql.UniqueIdentifier, id)
            .query(`
                SELECT NoteID, EncryptedBlob, IsOneTime
                FROM   dbo.SecretNotes
                WHERE  NoteID = @noteId
            `);

        // If no rows returned, the note doesn't exist (or was already burned)
        if (result.recordset.length === 0) {
            return res.status(404).json({
                error: 'Note not found. It may have already been read and destroyed, or never existed.',
            });
        }

        const note = result.recordset[0];

        // --- Burn-on-Read Logic ---
        // Delete the note BEFORE responding so even a race condition cannot
        // allow a second client to retrieve it while we're sending the response.
        if (note.IsOneTime) {
            await db.request()
                .input('noteId', mssql.UniqueIdentifier, id)
                .query(`DELETE FROM dbo.SecretNotes WHERE NoteID = @noteId`);

            console.log(`[API] Note burned (one-time read): ${id}`);
        } else {
            console.log(`[API] Note fetched (persistent): ${id}`);
        }

        // Return only the encrypted blob — NEVER plaintext.
        return res.status(200).json({
            encryptedBlob: note.EncryptedBlob,
            isOneTime:     note.IsOneTime === true || note.IsOneTime === 1,
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
        // Verify DB connection before accepting traffic
        await getPool();
        app.listen(PORT, () => {
            console.log(`\n🔒 LockBox server running at http://localhost:${PORT}`);
            console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
        });
    } catch (err) {
        console.error('[FATAL] Could not connect to the database:', err.message);
        console.error('        Check your .env configuration and ensure SQL Server is running.');
        process.exit(1);
    }
}

startServer();