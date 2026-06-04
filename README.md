# LockBox — Zero-Knowledge E2EE Note Sharing Platform

A full-stack web application for sharing encrypted notes and files. Notes are encrypted entirely in the browser before reaching the server — the server never sees plaintext data, and the decryption key never leaves the user's device.

---

## What It Does

LockBox allows users to create secret notes or encrypt files and share them via a single secure link. The recipient opens the link and the content is decrypted locally in their browser. Once read, the note is permanently destroyed from the server.

---

## Features

- **AES-256-GCM Client-Side Encryption** — All encryption and decryption happens in the browser using the native Web Crypto API (`window.crypto.subtle`). AES-GCM is authenticated encryption — tampered ciphertext is rejected immediately rather than silently producing garbage output.
- **PBKDF2 Key Derivation** — Passphrases are never used directly as keys. The Web Crypto API derives a 256-bit AES key via PBKDF2-SHA256 (200,000 iterations) with a random 16-byte salt, making brute-force attacks significantly harder.
- **Zero-Knowledge Architecture** — The secret key is embedded in the URL fragment (`#`). Browsers never include the fragment in HTTP requests, making it physically impossible for the server to receive it.
- **Burn-on-Read** — Notes are permanently deleted from the database before the server sends the response, ensuring one-time access.
- **Auto-Wipe Timer** — The sender can set a viewer-side timer (30 seconds, 1 minute, or 24 hours). When the countdown expires, the decrypted content is wiped from the viewer's screen and cannot be recovered.
- **File Encryption** — Encrypt and share files (PDFs, images, text files up to 5 MB). Files are read as `ArrayBuffer` and encrypted as raw binary — no base64 encoding overhead. Encrypted data is uploaded as `multipart/form-data`, keeping memory usage low even on mobile devices.
- **Passphrase Generator** — Generates a cryptographically secure 20-character random passphrase using `crypto.getRandomValues()` — the same API browsers use for TLS key generation.
- **State-Driven UI** — The create form uses a centralized state object with a single `render()` function. All UI updates flow through `setState()`, making the interface predictable and easy to extend.
- **SQL Injection Prevention** — All database queries use parameterized inputs via the `mssql` driver.
- **Background Expiry Cleanup** — A server-side job runs every 60 seconds to purge expired notes that were never viewed.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Encryption | Web Crypto API — AES-256-GCM + PBKDF2-SHA256 |
| Backend | Node.js, Express.js |
| Database | Microsoft SQL Server (SSMS) |
| DB Driver | mssql (npm) |

---

## Project Structure

```
Project/
├── server.js           # Express API server
├── package.json        # Node.js dependencies
├── .env                # Environment variables (never commit this)
├── .env.example        # Environment variable template
├── setup.sql           # Database and table creation script
├── README.md
└── public/
    ├── index.css      
    ├── index.html       
    ├── script.js      
    ├── view.css 
    ├── view.html        
    
```

---

## Setup & Installation

### Prerequisites

- Node.js v18 or later
- Microsoft SQL Server (any edition including Express)
- SQL Server Management Studio (SSMS)

### 1. Database Setup

Open SSMS, connect to your SQL Server instance, open `setup.sql` and execute it. This creates the `LockBoxDB` database and `SecretNotes` table.

### 2. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your SQL Server connection details:

```env
DB_SERVER=localhost
DB_INSTANCE=SQLEXPRESS
DB_NAME=LockBoxDB
DB_TRUSTED_CONNECTION=false
DB_USER=sa
DB_PASSWORD=yourpassword
PORT=3000
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Server

```bash
# Production
npm start

# Development (auto-restarts on file changes via nodemon)
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## How to Use

1. Type a secret note or select a file on the creation page
2. Enter a passphrase or click **Generate** for a secure random one
3. Configure burn-on-read and auto-wipe timer options
4. Click **Generate Secure Link**
5. Share the link with the recipient — the link contains both the note ID and the decryption key
6. The recipient opens the link and the note is decrypted locally in their browser
7. If burn-on-read is enabled, the note is permanently destroyed after the first view

---

## Security Notes

- The decryption key is never logged, stored, or transmitted to the server under any circumstances
- AES-256-GCM authentication means a wrong key or any tampering with the ciphertext is detected immediately — no silent decryption failures
- Burn-on-read deletion happens before the server response is sent, preventing race conditions
- Filenames are sanitized before encryption to prevent path traversal attacks
- All SQL queries use parameterized statements — SQL injection is not possible
- The project is intended for educational and academic use

---

## Future Improvements

- Refactor `server.js` into a layered MVC architecture (config/, routes/, controllers/, services/, middleware/)
- Add rate limiting via `express-rate-limit`
- Add unit tests for encryption and API logic