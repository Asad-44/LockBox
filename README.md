# LockBox
This project is made by Asad Shafiq(obv with the help of AI), anyway i enjoyed making it, spent nights bebugging just a '}' :)
For now i have not seprated the style and script code into serpate files for certain reasons.(future improvements)

LockBox — Zero-Knowledge E2EE Note Sharing Platform
A full-stack cybersecurity-focused web application for sharing encrypted notes and files. Notes are encrypted entirely in the browser before reaching the server — the server never sees plaintext data, and the decryption key never leaves the user's device.

What It Does
LockBox allows users to create secret notes or encrypt files and share them via a single secure link. The recipient opens the link and the content is decrypted locally in their browser. Once read, the note is permanently destroyed from the server.

Features

AES-256 Client-Side Encryption — All encryption and decryption happens in the browser using CryptoJS. The server is never involved in the cryptographic process.
Zero-Knowledge Architecture — The secret key is embedded in the URL fragment (#). Browsers never include the fragment in HTTP requests, making it physically impossible for the server to receive it.
Burn-on-Read — Notes are permanently deleted from the database before the server sends the response, ensuring one-time access.
Auto-Wipe Timer — The sender can set a viewer-side timer (30 seconds, 1 minute, or 24 hours). When the countdown expires, the decrypted content is wiped from the viewer's screen and cannot be recovered.
File Encryption — Encrypt and share files (PDFs, images, text files up to 5 MB). Files are base64-encoded, bundled with their filename, and AES-256 encrypted before upload. The server has no way to identify whether a blob is text or a file.
Passphrase Generator — Generates a cryptographically secure 20-character random passphrase using crypto.getRandomValues() — the same API browsers use for TLS key generation.
SQL Injection Prevention — All database queries use parameterized inputs via the mssql driver.
Background Expiry Cleanup — A server-side job runs every 60 seconds to purge expired notes that were never viewed.

Tech Stack
 Frontend:HTML5, CSS3, Vanilla JavaScript, Encryption: CryptoJS 4.2 (AES-256). Backend:Node.js, Express.js Database: Microsoft SQL Server (SSMS)DB Drivermssql (npm)

Setup & Installation
Prerequisites

Node.js v18 or later
Microsoft SQL Server (any edition including Express)
SQL Server Management Studio (SSMS)

1. Database Setup
Open SSMS, connect to your SQL Server instance, open setup.sql and execute it. This creates the LockBoxDB database and SecretNotes table.
2. Environment Configuration
bashcp .env.example .env
Edit .env with your SQL Server connection details:
envDB_SERVER=localhost
DB_INSTANCE=SQLEXPRESS
DB_NAME=LockBoxDB
DB_TRUSTED_CONNECTION=false
DB_USER=sa
DB_PASSWORD=yourpassword
PORT=3000
3. Install Dependencies
bashnpm install
4. Start the Server
bashnpm start
Open http://localhost:3000 in your browser.
(I have added nodemon script in package so that i dont need to restart node server everytime i made changes)

How to Use

Type a secret note or select a file on the creation page
Enter a passphrase or click Generate for a secure random one
Configure burn-on-read and auto-wipe timer options
Click Generate Secure Link
Share the link with the recipient — the link contains both the note ID and the decryption key
The recipient opens the link and the note is decrypted locally in their browser
If burn-on-read is enabled, the note is permanently destroyed after the first view


Security Notes

The decryption key is never logged, stored, or transmitted to the server under any circumstances
Burn-on-read deletion happens before the server response is sent, preventing race conditions
Filenames are sanitized before encryption to prevent path traversal attacks
All SQL queries use parameterized statements — SQL injection is not possible
The project is intended for educational and academic use

