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
- **Burn-on-Read** — Notes and files are permanently deleted from Redis immediately after being read, ensuring one-time access.
- **Auto-Wipe Timer** — The sender can set a viewer-side timer (30 seconds, 1 minute, or 24 hours). Expiry is enforced natively by Redis TTL, so the countdown reflects real remaining time even across refreshes, new tabs, or different browsers. When it reaches zero, the decrypted content is also wiped from the viewer's screen and cannot be recovered.
- **File Encryption** — Encrypt and share files (PDFs, images, text files up to 5 MB). Files are read as `ArrayBuffer` and encrypted as raw binary — no base64 encoding overhead on the client. Encrypted data is uploaded as `multipart/form-data` via `multer`, keeping memory usage low even on mobile devices.
- **Passphrase Generator** — Generates a cryptographically secure 20-character random passphrase using `crypto.getRandomValues()` — the same API browsers use for TLS key generation.
- **State-Driven UI** — The create form uses a centralized state object with a single `render()` function. All UI updates flow through `setState()`, making the interface predictable and easy to extend.
- **No-Cache API Responses** — The note-retrieval endpoint sends `Cache-Control: no-store` so burn-on-read and timer expiry are always checked against the live server state, never a stale browser cache.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Encryption | Web Crypto API — AES-256-GCM + PBKDF2-SHA256 |
| Backend | Node.js, Express.js |
| File Uploads | Multer (in-memory storage) |
| Data Store | Redis (TTL-based auto-expiry, native key-value storage) |
| Redis Client | `redis` (npm) |

---

## Project Structure

```
Project/
├── server.js           # Express API server
├── package.json        # Node.js dependencies
├── .env                # Environment variables (never commit this)
├── .env.example        # Environment variable template
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
- A Redis instance — either:
  - **Local**: Redis installed natively, via WSL, or via Docker (`docker run -d -p 6379:6379 redis:alpine`)
  - **Cloud (recommended)**: A free-tier managed Redis such as [Upstash](https://upstash.com)

### 1. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your Redis connection details:

```env
REDIS_URL=redis://localhost:6379
PORT=3000
```

For a managed cloud Redis (e.g. Upstash), use the TLS-enabled connection string it provides instead:

```env
REDIS_URL=rediss://default:yourpassword@your-endpoint.upstash.io:6379
PORT=3000
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

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
- Burn-on-read deletion happens immediately after the server reads the value from Redis, before the response is sent, minimizing race-condition risk
- Filenames are sanitized before encryption to prevent path traversal attacks
- Expiry is enforced by Redis itself (native TTL) rather than application-level timestamp checks, removing an entire class of "forgot to check expiry" bugs
- The project is intended for educational and academic use

---

## Future Improvements

- Refactor `server.js` into a layered MVC architecture (config/, routes/, controllers/, services/, middleware/)
- Add rate limiting via `express-rate-limit`
- Add unit tests for encryption and API logic
- Move file storage from base64-in-Redis to Redis binary-safe strings for lower memory overhead on larger files
