let currentTab = 'note';
let selectedFile = null;
let selectedTimer = null;

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

function selectTimer(seconds, btn) {
    selectedTimer = seconds;
    document.querySelectorAll('.timer-opt').forEach(o => o.classList.remove('selected'));
    btn.classList.add('selected');
}

function onFileSelected(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showError('File too large. Maximum size is 5 MB.'); return; }
    selectedFile = file;
    document.getElementById('chipName').textContent = file.name;
    document.getElementById('chipSize').textContent = formatBytes(file.size);
    document.getElementById('fileChip').classList.add('visible');
}

function clearFile() {
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileChip').classList.remove('visible');
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

function readFileAsBase64(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('Failed to read file.'));
        r.readAsDataURL(file);
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
    document.getElementById('noteText').value = '';
    document.getElementById('secretKey').value = '';
    document.getElementById('resultBox').classList.remove('visible');
    document.getElementById('passphraseReveal').classList.remove('visible');
    document.getElementById('passphraseHint').classList.remove('visible');
    document.getElementById('optionsPanel').style.display = 'flex';
    clearFile();
    hideError();
}

async function generateLink() {
    hideError();
    const secretKey = document.getElementById('secretKey').value.trim();
    const isOneTime = document.getElementById('isOneTime').checked;
    const btn = document.getElementById('generateBtn');

    if (!secretKey || secretKey.length < 4) {
        return showError('Enter a secret key (min 4 characters), or click Generate.');
    }
    if (currentTab === 'note' && !document.getElementById('noteText').value.trim()) {
        return showError('Please enter a note before generating a link.');
    }
    if (currentTab === 'file' && !selectedFile) {
        return showError('Please select a file to encrypt.');
    }

    btn.disabled = true;
    document.getElementById('optionsPanel').style.display = 'none';
    btn.textContent = 'Encrypting & uploading...';

    try {
        let encryptedBlob;
        const contentType = currentTab;

        if (contentType === 'note') {
            encryptedBlob = CryptoJS.AES.encrypt(
                document.getElementById('noteText').value.trim(), secretKey
            ).toString();
        } else {
            const dataUrl = await readFileAsBase64(selectedFile);
            const safeName = selectedFile.name.replace(/[^a-zA-Z0-9.\-_() ]/g, '_'); // sanitize filename
            const payload = JSON.stringify({ fileName: safeName, dataUrl });
            encryptedBlob = CryptoJS.AES.encrypt(payload, secretKey).toString();
        }

        const response = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                encryptedBlob,
                isOneTime,
                isFile: contentType === 'file',
                expirySeconds: selectedTimer,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server error (${response.status})`);
        }

        const data = await response.json();
        const base = `${window.location.origin}/view.html`;
        let query = `?id=${data.noteId}&type=${contentType}`;
        if (selectedTimer) query += `&timer=${selectedTimer}`;
        const shareUrl = `${base}${query}#${encodeURIComponent(secretKey)}`;

        document.getElementById('resultLink').textContent = shareUrl;

        const lines = [];
        if (isOneTime) lines.push('Burn-on-read: deleted after first view.');
        if (selectedTimer) lines.push(`Auto-wipe: ${formatTimer(selectedTimer)}.`);
        let safeName = '';
        if (contentType === 'file') {
            safeName = selectedFile.name.replace(/[^a-zA-Z0-9.\-_() ]/g, '_');
            lines.push(`File: "${safeName}"`);   // ← this line was missing
        }
        if (!isOneTime && !selectedTimer) lines.push('Persistent: can be viewed multiple times.');
        document.getElementById('resultMeta').innerHTML = lines.join('<br/>');

        document.getElementById('resultBox').classList.add('visible');

        // Scroll result into view on mobile
        // Professional scroll handling
        if (window.innerWidth < 769) {
            setTimeout(() => {
                document.getElementById('resultBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 50);
        } // Small delay to allow the DOM to render the block

    } catch (err) {
        showError(err.message || 'An unexpected error occurred.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Secure Link';
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
    document.getElementById('noteContent').textContent = '';
    decryptedFileData = null;
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
        return showError('No note ID found',
            'The URL does not contain a note ID.',
            'Make sure you copied the complete link including the ?id=... part.');
    }

    const rawHash = window.location.hash;
    const secretKey = rawHash.startsWith('#') ? decodeURIComponent(rawHash.slice(1)) : '';

    if (!secretKey) {
        return showError('Missing decryption key',
            'The URL does not contain a secret key in the # fragment.',
            'The complete link should look like: /view.html?id=GUID#YourKey');
    }

    let encryptedBlob, isOneTime, remainingSeconds;

    try {
        const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}`);

        if (response.status === 404) {
            const body = await response.json().catch(() => ({}));
            return showError(
                body.expired ? 'Note expired' : 'Note not found',
                body.expired
                    ? 'This note passed its expiry time and was permanently deleted.'
                    : 'This note no longer exists in the database.',
                'It may have already been read (burn-on-read), expired, or the link is incorrect.');
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server error (${response.status})`);
        }

        const data = await response.json();
        encryptedBlob = data.encryptedBlob;
        isOneTime = data.isOneTime;
        remainingSeconds = data.remainingSeconds || (isNaN(timerParam) ? null : timerParam);

    } catch (err) {
        return showError('Network error',
            `Could not reach the server: ${err.message}`,
            'Check your connection and try again.');
    }

    let plaintext;
    try {
        const decrypted = CryptoJS.AES.decrypt(encryptedBlob, secretKey);
        plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    } catch {
        return showError('Decryption failed',
            'An error occurred while decrypting this note.',
            'The encrypted data may be corrupted.');
    }

    if (!plaintext) {
        return showError('Wrong key',
            'Decryption produced no output. The secret key in the URL may be incorrect.',
            'Ensure the full link including the #key part was copied correctly.');
    }

    if (contentType === 'file') {
        let fileData;
        try { fileData = JSON.parse(plaintext); }
        catch {
            return showError('File parse error',
                'The decrypted content is not a valid file.',
                'The file may have been corrupted during encryption.');
        }
        showFileContent(fileData, isOneTime, remainingSeconds);
    } else {
        showNoteContent(plaintext, isOneTime, remainingSeconds);
    }
})();
