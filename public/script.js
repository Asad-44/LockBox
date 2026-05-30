// ── State (replaces currentTab, selectedFile, selectedTimer) ─────────────────
const state = {
    tab:    'note',   // 'note' | 'file'
    file:   null,     // File | null
    timer:  null,     // null | 30 | 60 | 86400
    phase:  'idle',   // 'idle' | 'loading' | 'done'
    result: null,     // { url, meta[] } | null
    error:  null,     // string | null
};

function setState(patch) {
    Object.assign(state, patch);
    render();
}

function render() {
    const { tab, file, timer, phase, result, error } = state;
    const isLoading = phase === 'loading';
    const isDone    = phase === 'done';

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tab === tab)
    );
    document.querySelectorAll('.tab-panel').forEach(panel =>
        panel.classList.toggle('active', panel.id === `tab-${tab}`)
    );

    // Timer options
    document.querySelectorAll('.timer-opt').forEach(opt => {
        const v = opt.dataset.timer === 'null' ? null : Number(opt.dataset.timer);
        opt.classList.toggle('selected', v === timer);
    });

    // File chip
    document.getElementById('fileChip').classList.toggle('visible', !!file);
    if (file) {
        document.getElementById('chipName').textContent = file.name;
        document.getElementById('chipSize').textContent = formatBytes(file.size);
    }

    // Controls
    document.getElementById('optionsPanel').style.display = isDone ? 'none' : 'flex';
    const btn = document.getElementById('generateBtn');
    btn.disabled    = isLoading;
    btn.textContent = isLoading ? 'Encrypting & uploading…' : 'Generate Secure Link';

    // Error box
    const errorBox = document.getElementById('errorBox');
    errorBox.textContent = error ? `Error: ${error}` : '';
    errorBox.classList.toggle('visible', !!error);

    // Result box
    document.getElementById('resultBox').classList.toggle('visible', isDone);
    if (isDone && result) {
        document.getElementById('resultLink').textContent = result.url;
        document.getElementById('resultMeta').innerHTML  = result.meta.join('<br/>');
    }
}

// ── CryptoUtils: Web Crypto API ──────────────────────────────────────────────
const CryptoUtils = (() => {
    const SALT_LEN = 16, IV_LEN = 12, ITERS = 200_000;
    const enc = new TextEncoder(), dec = new TextDecoder();

    async function _deriveKey(passphrase, salt, usage) {
        const raw = await crypto.subtle.importKey(
            'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: ITERS, hash: 'SHA-256' },
            raw, { name: 'AES-GCM', length: 256 }, false, usage
        );
    }

    // Builds [salt(16) | iv(12) | ciphertext] as a single Uint8Array
    async function _encrypt(bytes, passphrase) {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
        const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
        const key = await _deriveKey(passphrase, salt, ['encrypt']);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
        const out = new Uint8Array(SALT_LEN + IV_LEN + ct.byteLength);
        out.set(salt, 0);
        out.set(iv, SALT_LEN);
        out.set(new Uint8Array(ct), SALT_LEN + IV_LEN);
        return out;
    }

    async function _decrypt(bytes, passphrase) {
        const salt = bytes.subarray(0, SALT_LEN);
        const iv = bytes.subarray(SALT_LEN, SALT_LEN + IV_LEN);
        const ct = bytes.subarray(SALT_LEN + IV_LEN);
        const key = await _deriveKey(passphrase, salt, ['decrypt']);
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct); // throws on wrong key
    }

    // Safe base64 — avoids spread stack overflow on large arrays
    function _toBase64(u8) {
        let s = '';
        for (let i = 0; i < u8.length; i += 8192)
            s += String.fromCharCode(...u8.subarray(i, i + 8192));
        return btoa(s);
    }
    function _fromBase64(b64) {
        return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }

    return {
        async encryptText(text, passphrase) {
            return _toBase64(await _encrypt(enc.encode(text), passphrase));
        },
        async decryptText(b64, passphrase) {
            return dec.decode(await _decrypt(_fromBase64(b64), passphrase));
        },
        async encryptBuffer(arrayBuffer, passphrase) {
            const out = await _encrypt(new Uint8Array(arrayBuffer), passphrase);
            return new Blob([out], { type: 'application/octet-stream' });
        },
        async decryptBuffer(arrayBuffer, passphrase) {
            return _decrypt(new Uint8Array(arrayBuffer), passphrase);
        }
    };
})();
function switchTab(tab, btn) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.remove('active');
        // p.style.display = 'none';
    });
    const panel = document.getElementById('tab-' + tab);
    panel.classList.add('active');
    // panel.style.display = 'flex';
    if (tab === 'note') clearFile();
}

function switchTab(tab) {
    document.getElementById('fileInput').value = '';
    setState({ tab, file: null, error: null });
}

function selectTimer(seconds) {
    setState({ timer: seconds });
}

function onFileSelected(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setState({ error: 'File too large. Maximum size is 5 MB.' }); return; }
    setState({ file, error: null });
}

function clearFile() {
    document.getElementById('fileInput').value = '';
    setState({ file: null });
}

function onDragOver(e) { e.preventDefault(); document.getElementById('dropZone').classList.add('dragover'); }
function onDragLeave() { document.getElementById('dropZone').classList.remove('dragover'); }
function onDrop(e) {
    e.preventDefault();
    document.getElementById('dropZone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) onFileSelected(file);
}

function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
}

function readFileAsArrayBuffer(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); // ArrayBuffer — no encoding overhead
        r.onerror = () => rej(new Error('Failed to read file.'));
        r.readAsArrayBuffer(file);
    });
}

function generatePassphrase() {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
    const arr = new Uint8Array(20);
    crypto.getRandomValues(arr);
    const passphrase = Array.from(arr).map(b => charset[b % charset.length]).join('');
    document.getElementById('secretKey').value = passphrase;
    document.getElementById('passphraseText').textContent = passphrase;
    document.getElementById('passphraseReveal').classList.add('visible');
    document.getElementById('passphraseHint').classList.add('visible');
}

function showError(msg) {
    const box = document.getElementById('errorBox');
    box.textContent = 'Error: ' + msg;
    box.classList.add('visible');
}

function hideError() { document.getElementById('errorBox').classList.remove('visible'); }

function resetForm() {
    document.getElementById('noteText').value  = '';
    document.getElementById('secretKey').value = '';
    document.getElementById('passphraseReveal').classList.remove('visible');
    document.getElementById('passphraseHint').classList.remove('visible');
    document.getElementById('fileInput').value = '';
    setState({ tab: 'note', file: null, timer: null, phase: 'idle', result: null, error: null });
}

async function generateLink() {
    const secretKey = document.getElementById('secretKey').value.trim();
    const isOneTime = document.getElementById('isOneTime').checked;
    const { tab, file, timer } = state;

    // Validation — writes errors through state, no direct DOM
    if (!secretKey || secretKey.length < 4)
        return setState({ error: 'Enter a secret key (min 4 characters), or click Generate.' });
    if (tab === 'note' && !document.getElementById('noteText').value.trim())
        return setState({ error: 'Please enter a note before generating a link.' });
    if (tab === 'file' && !file)
        return setState({ error: 'Please select a file to encrypt.' });

    setState({ phase: 'loading', error: null }); // render() disables button + hides options

    try {
        let response;

        if (tab === 'note') {
            // Text notes: encrypt → base64 string → JSON body
            const encryptedBlob = await CryptoUtils.encryptText(
                document.getElementById('noteText').value.trim(), secretKey
            );
            response = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ encryptedBlob, isOneTime, isFile: false, expirySeconds: timer }),
            });

        } else {
            // Files: encrypt ArrayBuffer → Blob → multipart (no base64 bloat)
            const safeName = file.name.replace(/[^a-zA-Z0-9.\-_() ]/g, '_');
            const buffer   = await readFileAsArrayBuffer(file);
            const encBlob  = await CryptoUtils.encryptBuffer(buffer, secretKey);

            const form = new FormData();
            form.append('file',      encBlob,  'payload.bin');
            form.append('fileName',  safeName);
            form.append('isOneTime', String(isOneTime));
            form.append('isFile',    'true');
            if (timer) form.append('expirySeconds', String(timer));

            response = await fetch('/api/notes', { method: 'POST', body: form });
            // No Content-Type header — browser sets it automatically with the correct boundary
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server error (${response.status})`);
        }

        const data     = await response.json();
        const base     = `${window.location.origin}/view.html`;
        let   query    = `?id=${data.noteId}&type=${tab}`;
        if (timer) query += `&timer=${timer}`;
        const shareUrl = `${base}${query}#${encodeURIComponent(secretKey)}`;

        const meta = [];
        if (isOneTime)  meta.push('Burn-on-read: deleted after first view.');
        if (timer)      meta.push(`Auto-wipe: ${formatTimer(timer)}.`);
        if (tab === 'file') meta.push(`File: "${file.name.replace(/[^a-zA-Z0-9.\-_() ]/g, '_')}"`);
        if (!isOneTime && !timer) meta.push('Persistent: can be viewed multiple times.');

        setState({ phase: 'done', result: { url: shareUrl, meta } }); // render() shows result box

        if (window.innerWidth < 769)
            setTimeout(() => document.getElementById('resultBox')
                .scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

    } catch (err) {
        setState({ phase: 'idle', error: err.message || 'An unexpected error occurred.' });
        // render() re-enables button automatically
    }
}

function formatTimer(s) {
    if (s === 30) return '30 seconds';
    if (s === 60) return '1 minute';
    if (s === 86400) return '24 hours';
    return s + 's';
}

async function copyLink() {
    const link = document.getElementById('resultLink').textContent;
    try {
        await navigator.clipboard.writeText(link);
        const btn = document.querySelector('.btn-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy to clipboard'; }, 2000);
    } catch {
        const el = document.createElement('textarea');
        el.value = link;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
    }
}


let decryptedFileData = null;
let timerInterval = null;

function showError(title, message, sub = '') {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorSub').textContent = sub;
    document.getElementById('errorState').style.display = 'block';
}

function showNoteContent(plaintext, isOneTime, timerSeconds) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('stateLabel').textContent = 'Decrypted note';
    document.getElementById('cardLabel').textContent = 'Message';
    document.getElementById('noteContent').textContent = plaintext;
    document.getElementById('noteContent').style.display = 'block';
    document.getElementById('fileCard').style.display = 'none';
    document.getElementById('copyBtn').style.display = 'block';
    if (isOneTime) document.getElementById('burnNotice').style.display = 'block';
    document.getElementById('noteState').style.display = 'block';
    if (timerSeconds) startTimer(timerSeconds);
}

function showFileContent(fileData, isOneTime, timerSeconds) {
    decryptedFileData = fileData;
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('stateLabel').textContent = 'Decrypted file';
    document.getElementById('cardLabel').textContent = 'File';
    document.getElementById('noteContent').style.display = 'none';
    document.getElementById('copyBtn').style.display = 'none';
    document.getElementById('fileName').textContent = fileData.fileName;
    document.getElementById('fileCard').style.display = 'flex';
    if (isOneTime) document.getElementById('burnNotice').style.display = 'block';
    document.getElementById('noteState').style.display = 'block';
    if (timerSeconds) startTimer(timerSeconds);
}

async function copyNote() {
    const text = document.getElementById('noteContent').textContent;
    try {
        await navigator.clipboard.writeText(text);
        const btn = document.getElementById('copyBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    } catch {
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
    }
}

function downloadFile() {
    if (!decryptedFileData) return;
    const a = document.createElement('a');
    a.href = decryptedFileData.dataUrl;
    a.download = decryptedFileData.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function startTimer(totalSeconds) {
    const bar = document.getElementById('timerBar');
    const fill = document.getElementById('timerFill');
    const count = document.getElementById('timerCount');
    bar.style.display = 'block';
    let remaining = totalSeconds;

    function formatTime(s) {
        if (s >= 3600) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; }
        if (s >= 60) { const m = Math.floor(s / 60), sec = s % 60; return `${m}m ${sec.toString().padStart(2, '0')}s`; }
        return `${s}s`;
    }

    count.textContent = formatTime(remaining);
    fill.style.width = '100%';

    timerInterval = setInterval(() => {
        remaining--;
        count.textContent = formatTime(remaining);
        fill.style.width = ((remaining / totalSeconds) * 100) + '%';
        if (remaining <= 0) { clearInterval(timerInterval); wipeContent(); }
    }, 1000);
}

function wipeContent() {
    // Release the blob URL so the browser can reclaim memory
    if (decryptedFileData?.dataUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(decryptedFileData.dataUrl);
    }
    decryptedFileData = null;
    document.getElementById('noteContent').textContent = '';
    document.getElementById('contentCard').style.display = 'none';
    document.getElementById('timerBar').style.display = 'none';
    document.getElementById('burnNotice').style.display = 'none';
    document.getElementById('wipedOverlay').classList.add('visible');
}

// Main
(async function init() {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get('id');
    const contentType = params.get('type') || 'note';
    const timerParam = parseInt(params.get('timer'));

    if (!noteId) {
        return showError('No note ID found', 'The URL does not contain a note ID.');
    }

    const rawHash = window.location.hash;
    const secretKey = rawHash.startsWith('#') ? decodeURIComponent(rawHash.slice(1)) : '';

    if (!secretKey) {
        return showError('Missing decryption key', 'The URL is missing the #secretKey part.');
    }

    try {
        const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}`);

        if (response.status === 404) {
            const body = await response.json().catch(() => ({}));
            return showError(
                body.expired ? 'Note expired' : 'Note not found',
                body.expired ? 'This note has expired and was deleted.' : 'This note no longer exists.'
            );
        }

        if (!response.ok) throw new Error(`Server error (${response.status})`);

        // --- BRANCH BY CONTENT TYPE ---
        
        if (contentType === 'file') {
            // 1. Handle Binary File
            const encBuffer = await response.arrayBuffer();
            const decBuffer = await CryptoUtils.decryptBuffer(encBuffer, secretKey);
            
            // Extract metadata from headers (Ensure your server exposes these!)
            const fileName = decodeURIComponent(response.headers.get('X-File-Name') || 'downloaded_file');
            const isOneTime = response.headers.get('X-Is-One-Time') === 'true';
            const remainingSeconds = parseInt(response.headers.get('X-Remaining-Seconds')) || null;
            
            const objectUrl = URL.createObjectURL(new Blob([decBuffer]));
            showFileContent({ fileName, dataUrl: objectUrl }, isOneTime, remainingSeconds);

        } else {
            // 2. Handle Text Note
            const data = await response.json();
            const plaintext = await CryptoUtils.decryptText(data.encryptedBlob, secretKey);
            
            const remainingSeconds = data.remainingSeconds || (isNaN(timerParam) ? null : timerParam);
            showNoteContent(plaintext, data.isOneTime, remainingSeconds);
        }

        // --- CLEANUP ---
        // Senior Tip: Remove the key from the URL bar for extra security
        window.history.replaceState(null, '', window.location.pathname + window.location.search);

    } catch (err) {
        console.error(err);
        return showError(
            'Decryption Failed',
            'AES-GCM authentication failed. The key is incorrect or data was corrupted.',
            'Note: Links created before the security update are no longer compatible.'
        );
    }
})();