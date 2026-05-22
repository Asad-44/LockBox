-- =============================================================================
-- LockBox v2 — Database Setup Script
-- Run this in SSMS connected to HP\SQLEXPRESS
-- Safe to re-run: all steps use IF NOT EXISTS checks
-- =============================================================================

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'LockBoxDB')
BEGIN
    CREATE DATABASE LockBoxDB;
    PRINT 'Database LockBoxDB created.';
END
GO

USE LockBoxDB;
GO

IF NOT EXISTS (
    SELECT * FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[SecretNotes]') AND type = N'U'
)
BEGIN
    CREATE TABLE dbo.SecretNotes (
        NoteID        UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),  -- Auto GUID primary key
        EncryptedBlob NVARCHAR(MAX)    NOT NULL,                  -- AES-256 ciphertext (server never decrypts this)
        IsOneTime     BIT              NOT NULL DEFAULT 1,        -- 1 = burn after first read
        IsFile        BIT              NOT NULL DEFAULT 0,        -- 1 = blob is an encrypted file attachment
        ExpirySeconds INT              NULL,                      -- Viewer-side wipe timer: 30, 60, 86400, or NULL
        ExpiresAt     DATETIME         NULL,                      -- Server-side expiry timestamp (NULL = never)
        CreatedAt     DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT PK_SecretNotes PRIMARY KEY CLUSTERED (NoteID)
    );
    PRINT 'Table SecretNotes created successfully.';
END
ELSE
BEGIN
    -- Safe upgrade: add new columns if coming from v1 schema
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SecretNotes') AND name = 'IsFile')
        ALTER TABLE dbo.SecretNotes ADD IsFile BIT NOT NULL DEFAULT 0;
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SecretNotes') AND name = 'ExpirySeconds')
        ALTER TABLE dbo.SecretNotes ADD ExpirySeconds INT NULL;
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SecretNotes') AND name = 'ExpiresAt')
        ALTER TABLE dbo.SecretNotes ADD ExpiresAt DATETIME NULL;
    PRINT 'Table SecretNotes already exists — new columns added if missing.';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_SecretNotes_ExpiresAt' AND object_id = OBJECT_ID(N'dbo.SecretNotes'))
BEGIN
    CREATE INDEX IX_SecretNotes_ExpiresAt ON dbo.SecretNotes (ExpiresAt);
    PRINT 'Index on ExpiresAt created.';
END
GO

PRINT '=== LockBoxDB v2 setup complete ===';
GO