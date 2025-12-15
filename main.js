const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

let mainWindow;
let isPassive = false; // Start in active mode
let wss = null;
let httpServer = null;
let httpTunnel = null;
let wsTunnel = null;
let httpTunnelProcess = null;
let wsTunnelProcess = null;
const WS_PORT = 8765;

// Generate random session code
function generateSessionCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Generate random admin password (8 chars, alphanumeric)
function generateAdminPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

let sessionCode = generateSessionCode();
let adminPassword = generateAdminPassword();

// --- Chat logging (per-session) ---
let chatLogStream = null;
let chatLogFilePath = null;
let chatLogDir = null;
const messageIndex = new Map(); // msgId -> { id, user, text, ip, timestamp }

// --- Feedback logging (per "collection cycle") ---
let feedbackLogStream = null;
let feedbackLogFilePath = null;
let feedbackCycleId = 0;
let feedbackSubmittedIps = new Set(); // per-cycle

// --- IP blocking (per-session) ---
const blockedIps = new Set(); // ip -> blocked
const deletionsByIp = new Map(); // ip -> deleteCount (messages deleted by admin)

function safeMkdir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        return true;
    } catch (_) {
        return false;
    }
}

function isWritableDir(dir) {
    try {
        const testPath = path.join(dir, `.write-test-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
        fs.writeFileSync(testPath, 'ok');
        fs.unlinkSync(testPath);
        return true;
    } catch (_) {
        return false;
    }
}

function pickLogDir() {
    // Prefer the folder where the app is run from (dev), otherwise fall back to userData (packaged-safe).
    const candidates = [];
    try { candidates.push(path.join(process.cwd(), 'chat-logs')); } catch (_) {}
    try { candidates.push(path.join(__dirname, 'chat-logs')); } catch (_) {}
    try { candidates.push(path.join(app.getPath('userData'), 'chat-logs')); } catch (_) {}

    for (const dir of candidates) {
        if (!dir) continue;
        if (!safeMkdir(dir)) continue;
        if (!isWritableDir(dir)) continue;
        return dir;
    }
    // Last resort: userData even if not writable test (avoid crashing).
    try { return path.join(app.getPath('userData'), 'chat-logs'); } catch (_) { return path.join(process.cwd(), 'chat-logs'); }
}

function initChatLogging() {
    chatLogDir = pickLogDir();
    safeMkdir(chatLogDir);
    const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `chat-session-${sessionCode}-${startedAt}.jsonl`;
    chatLogFilePath = path.join(chatLogDir, filename);
    chatLogStream = fs.createWriteStream(chatLogFilePath, { flags: 'a' });

    writeChatLog({
        type: 'session-start',
        sessionCode,
        startedAt: new Date().toISOString()
    });

    console.log(`Chat logging enabled: ${chatLogFilePath}`);
}

function writeChatLog(obj) {
    try {
        if (!chatLogStream) return;
        chatLogStream.write(`${JSON.stringify(obj)}\n`);
    } catch (e) {
        console.error('Failed to write chat log:', e);
    }
}

function closeChatLogging() {
    try {
        if (chatLogStream) {
            writeChatLog({
                type: 'session-end',
                sessionCode,
                endedAt: new Date().toISOString()
            });
            chatLogStream.end();
        }
    } catch (_) {
        // ignore
    } finally {
        chatLogStream = null;
    }
}

function normalizeIp(ip) {
    if (!ip) return null;
    return String(ip).replace(/^::ffff:/, '');
}

function getClientIpFromReq(req) {
    // Cloudflare provides real client IP in CF-Connecting-IP header (most reliable)
    // Check both lowercase and original case (headers can vary)
    const cfIp = req?.headers?.['cf-connecting-ip'] || req?.headers?.['CF-Connecting-IP'];
    if (cfIp && typeof cfIp === 'string') {
        const n = normalizeIp(cfIp.trim());
        if (n) {
            return n; // Trust Cloudflare header - it contains the real client IP
        }
    }
    // Fallback to X-Forwarded-For (may contain multiple IPs, take first)
    const xf = req?.headers?.['x-forwarded-for'] || req?.headers?.['X-Forwarded-For'];
    if (xf && typeof xf === 'string') {
        // X-Forwarded-For format: "client, proxy1, proxy2"
        // Real client is usually first, but take first non-private if available
        const ips = xf.split(',').map(ip => ip.trim());
        for (const ip of ips) {
            const n = normalizeIp(ip);
            if (n) {
                // Prefer first IP (real client), but if it's a known proxy IP, try next
                // Cloudflare IPs typically start with 104.x or are in specific ranges
                if (!n.startsWith('104.') && !n.startsWith('172.64.') && !n.startsWith('172.65.')) {
                    return n;
                }
            }
        }
        // If all look like proxies, return first one anyway
        if (ips.length > 0) {
            const n = normalizeIp(ips[0]);
            if (n) return n;
        }
    }
    // Last resort: direct connection IP (will be Cloudflare's IP if behind tunnel)
    const raw = req?.socket?.remoteAddress || null;
    const normalized = normalizeIp(raw);
    
    // Log warning if we're falling back to proxy IP (indicates headers not being passed)
    if (normalized && (normalized.startsWith('104.') || normalized.startsWith('172.64.') || normalized.startsWith('172.65.'))) {
        console.warn('Warning: Using Cloudflare proxy IP instead of real client IP. Headers not available:', {
            'cf-connecting-ip': req?.headers?.['cf-connecting-ip'] || req?.headers?.['CF-Connecting-IP'] || 'missing',
            'x-forwarded-for': req?.headers?.['x-forwarded-for'] || req?.headers?.['X-Forwarded-For'] || 'missing',
            'all-headers': Object.keys(req?.headers || {}).filter(k => k.toLowerCase().includes('ip') || k.toLowerCase().includes('forward'))
        });
    }
    return normalized;
}

function initFeedbackLoggingForCycle() {
    // Reuse chat log directory selection so we always write somewhere writable.
    if (!chatLogDir) chatLogDir = pickLogDir();
    safeMkdir(chatLogDir);
    const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `feedback-session-${sessionCode}-cycle-${feedbackCycleId}-${startedAt}.jsonl`;
    feedbackLogFilePath = path.join(chatLogDir, filename);
    feedbackLogStream = fs.createWriteStream(feedbackLogFilePath, { flags: 'a' });
    writeFeedbackLog({
        type: 'feedback-cycle-start',
        sessionCode,
        feedbackCycleId,
        startedAt: new Date().toISOString()
    });
    console.log(`Feedback logging enabled: ${feedbackLogFilePath}`);
}

function writeFeedbackLog(obj) {
    try {
        if (!feedbackLogStream) return;
        feedbackLogStream.write(`${JSON.stringify(obj)}\n`);
    } catch (e) {
        console.error('Failed to write feedback log:', e);
    }
}

function closeFeedbackLogging() {
    try {
        if (feedbackLogStream) {
            writeFeedbackLog({
                type: 'feedback-cycle-end',
                sessionCode,
                feedbackCycleId,
                endedAt: new Date().toISOString()
            });
            feedbackLogStream.end();
        }
    } catch (_) {
        // ignore
    } finally {
        feedbackLogStream = null;
    }
}

function startNewFeedbackCycle(meta = {}) {
    // Increment cycle and reset per-cycle submission tracking.
    feedbackCycleId = (feedbackCycleId || 0) + 1;
    feedbackSubmittedIps = new Set();
    closeFeedbackLogging();
    initFeedbackLoggingForCycle();
    writeFeedbackLog({
        type: 'feedback-cycle-reset',
        sessionCode,
        feedbackCycleId,
        at: new Date().toISOString(),
        ...meta
    });
}

function setFeedbackEnabled(enabled, meta = {}) {
    const next = !!enabled;
    const prev = !!currentSettings.enableFeedbackForm;
    if (prev === next) return;

    currentSettings.enableFeedbackForm = next;
    if (next) {
        // Turning ON starts a fresh collection cycle.
        startNewFeedbackCycle({
            reason: 'enabled',
            ...meta
        });
        currentSettings.feedbackCycleId = feedbackCycleId;
    }
}

function broadcastBlockedIps() {
    broadcastToAdmins({
        type: 'blocked-ips-update',
        blockedIps: Array.from(blockedIps)
    });
}

function blockIp(ip, meta = {}) {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;
    if (blockedIps.has(normalized)) return false;
    blockedIps.add(normalized);
    writeChatLog({
        type: 'ip-blocked',
        sessionCode,
        ip: normalized,
        at: new Date().toISOString(),
        ...meta
    });
    broadcastBlockedIps();
    return true;
}

function unblockIp(ip, meta = {}) {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;
    if (!blockedIps.has(normalized)) return false;
    blockedIps.delete(normalized);
    deletionsByIp.delete(normalized); // reset counter on manual unblock
    writeChatLog({
        type: 'ip-unblocked',
        sessionCode,
        ip: normalized,
        at: new Date().toISOString(),
        ...meta
    });
    broadcastBlockedIps();
    return true;
}

// Current overlay settings (synced with admin)
let currentSettings = {
    maxMessages: 5,
    fontSize: 13,
    showJoinCode: false,
    showMobileLink: false,
    disableChatHistory: true,
    // Hide IP: when true, use Cloudflare URLs; when false, use local URLs
    hideIp: false,
    // Emoji shortcut shown on mobile + admin pages
    customEmoji: '⭐',
    // When true, emoji buttons send directly; when false, they insert into text box
    emojiDirectSend: true,
    // Slow mode: require gap between messages per user
    slowModeEnabled: false,
    slowModeSeconds: 3,
    // Feedback form control (synced to all mobile clients)
    enableFeedbackForm: false,
    // Incremented each time feedback is enabled to create a new "event"
    feedbackCycleId: 0
};

// Track last message time per user (by IP) for slow mode
const lastMessageTimeByIp = new Map();

// Track admin clients
const adminClients = new Set();

// Linux: Required for transparency
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-gpu');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 450,
        height: 420,
        x: 50,
        y: 300,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        focusable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Start in active mode (interactive)
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setFocusable(true);
    mainWindow.loadFile('index.html');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    
    // Open settings on first load
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('mode-change', 'active');
        mainWindow.webContents.send('open-settings');
        mainWindow.focus();
    });
}

function toggleMode() {
    isPassive = !isPassive;
    
    mainWindow.setIgnoreMouseEvents(isPassive, { forward: isPassive });
    mainWindow.setFocusable(!isPassive);
    
    if (!isPassive) mainWindow.focus();
    
    mainWindow.webContents.send('mode-change', isPassive ? 'passive' : 'active');
    console.log(`Mode: ${isPassive ? 'Passive' : 'Active'}`);
}

// Generate join page HTML (shown when no session code provided)
function generateJoinPageHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Join Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #000; --accent: #8a8a8a; --text: #e8e8e8; --text-dim: #9a9a9a; --border: rgba(255,255,255,0.18); }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); font-family: 'Outfit', sans-serif; color: var(--text); }
    .container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100%; padding: 24px; text-align: center; }
    h1 { font: 600 24px 'JetBrains Mono', monospace; color: var(--accent); margin: 0 0 12px 0; }
    p { color: var(--text-dim); margin: 0 0 32px 0; font-size: 14px; }
    .form-group { width: 100%; max-width: 280px; margin-bottom: 20px; }
    label { display: block; font: 500 11px 'JetBrains Mono', monospace; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; text-align: left; }
    input { width: 100%; padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 10px; color: var(--text); font: 600 20px 'JetBrains Mono', monospace; text-align: center; text-transform: uppercase; letter-spacing: 4px; outline: none; }
    input:focus { border-color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.05); }
    input::placeholder { color: var(--text-dim); letter-spacing: 2px; font-size: 14px; }
    .btn { width: 100%; max-width: 280px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--text); font: 600 16px 'Outfit', sans-serif; cursor: pointer; }
    .btn:active { transform: scale(0.98); }
    .error { color: #b24b57; font-size: 13px; margin-top: 16px; display: none; }
    .error.visible { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Join Chat</h1>
    <p>Enter the session code to join</p>
    <div class="form-group">
      <label>Session Code</label>
      <input type="text" id="code-input" placeholder="ABC123" maxlength="6" autocomplete="off" autocapitalize="characters" autofocus>
    </div>
    <button class="btn" id="join-btn">Join Session</button>
    <div class="error" id="error-msg">Invalid session code</div>
  </div>
  <script>
    const input = document.getElementById('code-input');
    const btn = document.getElementById('join-btn');
    const error = document.getElementById('error-msg');
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); error.classList.remove('visible'); });
    function join() {
      const code = input.value.trim();
      if (code.length < 4) { error.textContent = 'Please enter a valid session code'; error.classList.add('visible'); return; }
      window.location.href = '/?s=' + encodeURIComponent(code);
    }
    btn.onclick = join;
    input.onkeypress = (e) => { if (e.key === 'Enter') join(); };
  </script>
</body>
</html>`;
}

// Generate session not found page HTML
function generateSessionNotFoundHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <title>Session Not Found</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #000; --accent: #8a8a8a; --text: #e8e8e8; --text-dim: #9a9a9a; --border: rgba(255,255,255,0.18); --warning: #b08a46; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); font-family: 'Outfit', sans-serif; color: var(--text); }
    .container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100%; padding: 24px; text-align: center; }
    .icon { font-size: 48px; margin-bottom: 20px; }
    h1 { font: 600 20px 'JetBrains Mono', monospace; color: var(--warning); margin: 0 0 12px 0; }
    p { color: var(--text-dim); margin: 0 0 32px 0; font-size: 14px; line-height: 1.6; max-width: 300px; }
    .btn { padding: 14px 28px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--text); font: 500 14px 'Outfit', sans-serif; cursor: pointer; text-decoration: none; }
    .btn:active { transform: scale(0.98); }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🔒</div>
    <h1>Session Not Found</h1>
    <p>This session code is invalid or the event has ended. Please check your code or ask the host for a new link.</p>
    <a href="/" class="btn">Enter Different Code</a>
  </div>
</body>
</html>`;
}

// Parse session code from URL query string
function getSessionCodeFromUrl(urlString) {
    try {
        // Handle URLs that might not have a host
        const url = new URL(urlString, 'http://localhost');
        return url.searchParams.get('s') || null;
    } catch (e) {
        return null;
    }
}

// Create HTTP server to serve mobile app
function createHttpServer() {
    httpServer = http.createServer((req, res) => {
        // Parse URL and query params
        const parsedUrl = new URL(req.url, `http://localhost:${WS_PORT + 1}`);
        const pathname = parsedUrl.pathname;
        const providedCode = parsedUrl.searchParams.get('s');

        // Feedback submission endpoint (same origin as mobile page)
        if (pathname === '/feedback') {
            if (req.method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
                return;
            }

            // If feedback is disabled, reject (clients should hide the form anyway)
            if (!currentSettings.enableFeedbackForm) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'feedback_disabled' }));
                return;
            }

            const ip = getClientIpFromReq(req);
            if (!ip) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'ip_unknown' }));
                return;
            }

            // Enforce "one per IP per cycle"
            if (feedbackSubmittedIps.has(ip)) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'already_submitted' }));
                return;
            }

            let body = '';
            req.on('data', (chunk) => {
                body += chunk.toString('utf8');
                // prevent abuse
                if (body.length > 20_000) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'payload_too_large' }));
                    try { req.destroy(); } catch (_) {}
                }
            });
            req.on('end', () => {
                let payload = null;
                try {
                    payload = JSON.parse(body || '{}');
                } catch (_) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
                    return;
                }

                const rating = parseInt(payload.rating, 10);
                if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'invalid_rating' }));
                    return;
                }

                const comment = truncateToMaxWords(payload.comment || '', 150);

                // Ensure a log stream exists for this cycle
                if (!feedbackLogStream) {
                    // Should not happen if enabled, but keep it safe.
                    feedbackCycleId = currentSettings.feedbackCycleId || feedbackCycleId || 0;
                    initFeedbackLoggingForCycle();
                }

                feedbackSubmittedIps.add(ip);
                writeFeedbackLog({
                    type: 'feedback',
                    sessionCode,
                    feedbackCycleId: currentSettings.feedbackCycleId || feedbackCycleId,
                    at: new Date().toISOString(),
                    ip,
                    rating,
                    comment
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            });
            return;
        }

        // Serve mobile app (requires valid session code)
        if (pathname === '/' || pathname === '/index.html') {
            // No session code provided - show join page
            if (!providedCode) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(generateJoinPageHtml());
                return;
            }

            // Wrong session code - show error page
            if (providedCode.toUpperCase() !== sessionCode) {
                res.writeHead(403, { 'Content-Type': 'text/html' });
                res.end(generateSessionNotFoundHtml());
                return;
            }

            // Valid session code - serve mobile app with injected WebSocket URL
            const mobilePath = path.join(__dirname, 'mobile', 'index.html');
            fs.readFile(mobilePath, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Mobile app not found');
                    return;
                }
                // Detect if request is coming through Cloudflare tunnel or locally
                const isCloudflareRequest = req.headers['cf-connecting-ip'] || 
                                          req.headers['CF-Connecting-IP'] ||
                                          (req.headers.host && req.headers.host.includes('trycloudflare.com'));
                
                // Inject appropriate WebSocket URL based on request source
                let html = data;
                const localIP = getLocalIP();
                let wsUrlHost = null;
                let forceLocal = false;
                
                if (isCloudflareRequest && wsTunnel) {
                    // Cloudflare request - use Cloudflare WebSocket tunnel
                    wsUrlHost = wsTunnel.url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
                } else {
                    // Local request - ALWAYS use local WebSocket server (force override)
                    wsUrlHost = `${localIP}:${WS_PORT}`;
                    forceLocal = true;
                }
                
                if (wsUrlHost) {
                    // Inject as meta tag and inline script that runs immediately
                    const injectMeta = `<meta name="default-ws-url" content="${wsUrlHost}">`;
                    const injectScript = `<script>
                        (function() {
                            const defaultWsUrl = '${wsUrlHost}';
                            const isLocalRequest = ${forceLocal ? 'true' : 'false'};
                            if (defaultWsUrl) {
                                // For local requests, ALWAYS override localStorage to ensure local WebSocket is used
                                if (isLocalRequest) {
                                    localStorage.setItem('livechat_server', defaultWsUrl);
                                    window.__defaultWsUrl = defaultWsUrl;
                                } else {
                                    // For Cloudflare requests, only update if needed
                                    const existing = localStorage.getItem('livechat_server') || '';
                                    const shouldUpdate = !existing || 
                                        existing.includes('10.') || 
                                        existing.includes('192.168.') || 
                                        existing.includes('172.') || 
                                        existing === window.location.hostname + ':8765' ||
                                        existing.includes('localhost');
                                    if (shouldUpdate) {
                                        localStorage.setItem('livechat_server', defaultWsUrl);
                                        window.__defaultWsUrl = defaultWsUrl;
                                    }
                                }
                            }
                        })();
                    </script>`;
                    // Inject in head, before any other scripts
                    html = html.replace('<head>', '<head>' + injectMeta + injectScript);
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            });
        } else if (pathname === '/admin' || pathname === '/admin.html') {
            const adminPath = path.join(__dirname, 'mobile', 'admin.html');
            fs.readFile(adminPath, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Admin page not found');
                    return;
                }
                // Detect if request is coming through Cloudflare tunnel or locally
                const isCloudflareRequest = req.headers['cf-connecting-ip'] || 
                                          req.headers['CF-Connecting-IP'] ||
                                          (req.headers.host && req.headers.host.includes('trycloudflare.com'));
                
                // Inject appropriate WebSocket URL based on request source
                let html = data;
                const localIP = getLocalIP();
                let wsUrlHost = null;
                let forceLocal = false;
                
                if (isCloudflareRequest && wsTunnel) {
                    // Cloudflare request - use Cloudflare WebSocket tunnel
                    wsUrlHost = wsTunnel.url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
                } else {
                    // Local request - ALWAYS use local WebSocket server (force override)
                    wsUrlHost = `${localIP}:${WS_PORT}`;
                    forceLocal = true;
                }
                
                if (wsUrlHost) {
                    // Inject as meta tag and inline script that runs immediately
                    const injectMeta = `<meta name="default-ws-url" content="${wsUrlHost}">`;
                    const injectScript = `<script>
                        (function() {
                            const defaultWsUrl = '${wsUrlHost}';
                            const isLocalRequest = ${forceLocal ? 'true' : 'false'};
                            if (defaultWsUrl) {
                                // For local requests, ALWAYS override localStorage to ensure local WebSocket is used
                                if (isLocalRequest) {
                                    localStorage.setItem('livechat_server', defaultWsUrl);
                                    window.__defaultWsUrl = defaultWsUrl;
                                } else {
                                    // For Cloudflare requests, only update if needed
                                    const existing = localStorage.getItem('livechat_server') || '';
                                    const shouldUpdate = !existing || 
                                        existing.includes('10.') || 
                                        existing.includes('192.168.') || 
                                        existing.includes('172.') || 
                                        existing === window.location.hostname + ':8765' ||
                                        existing.includes('localhost');
                                    if (shouldUpdate) {
                                        localStorage.setItem('livechat_server', defaultWsUrl);
                                        window.__defaultWsUrl = defaultWsUrl;
                                    }
                                }
                            }
                        })();
                    </script>`;
                    // Inject in head, before any other scripts
                    html = html.replace('<head>', '<head>' + injectMeta + injectScript);
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            });
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    httpServer.listen(WS_PORT + 1, () => {
        console.log(`Mobile app available at http://localhost:${WS_PORT + 1}`);
    });
}

// Broadcast to all admin clients
function broadcastToAdmins(data) {
    adminClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Message ID counter
let messageIdCounter = 0;

// Per-message limit across all clients
const MAX_WORDS_PER_MESSAGE = 50;

function normalizeWhitespace(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

function truncateToMaxWords(text, maxWords) {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return '';
    const words = normalized.split(' ').filter(Boolean);
    if (words.length <= maxWords) return normalized;
    return words.slice(0, maxWords).join(' ');
}

// Create WebSocket server
function createWebSocketServer() {
    wss = new WebSocket.Server({ port: WS_PORT });
    
    wss.on('connection', (ws, req) => {
        // Extract real client IP from Cloudflare headers (for tunnel connections)
        const clientIp = getClientIpFromReq(req);
        console.log('Client connected', clientIp ? `(${clientIp})` : '');
        ws.isAdmin = false;
        ws.clientIp = clientIp;
        ws.sessionValidated = false; // Must validate session code before chatting
        
        // Timeout for unvalidated connections (10 seconds)
        const validationTimeout = setTimeout(() => {
            if (!ws.sessionValidated && ws.readyState === WebSocket.OPEN) {
                console.log('Client disconnected (validation timeout)', clientIp ? `(${clientIp})` : '');
                try {
                    ws.close(1008, 'Session validation timeout');
                } catch (_) {}
            }
        }, 10000);
        
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                // Session join request - must be validated before other actions
                if (msg.type === 'join') {
                    const providedCode = String(msg.sessionCode || '').toUpperCase().trim();
                    if (providedCode === sessionCode) {
                        ws.sessionValidated = true;
                        ws.send(JSON.stringify({ type: 'join-result', success: true, code: sessionCode }));
                        // Send settings after successful join
                        try {
                            const urls = getUrls();
                            ws.send(JSON.stringify({
                                type: 'settings-sync',
                                settings: currentSettings,
                                mobileUrl: urls.mobileUrl,
                                wsUrl: urls.wsUrl
                            }));
                        } catch (e) {
                            // Non-fatal
                        }
                        clearTimeout(validationTimeout); // Clear timeout on successful join
                        console.log('Client joined session', clientIp ? `(${clientIp})` : '');
                    } else {
                        ws.send(JSON.stringify({ type: 'join-result', success: false, error: 'invalid_session' }));
                        // Close the connection after failed join
                        clearTimeout(validationTimeout);
                        setTimeout(() => {
                            try { ws.close(1008, 'Invalid session code'); } catch (_) {}
                        }, 100);
                    }
                    return;
                }

                // Admin authentication (doesn't require session validation - uses password)
                if (msg.type === 'admin-auth') {
                    const success = msg.password === adminPassword;
                    if (success) {
                        ws.isAdmin = true;
                        ws.sessionValidated = true; // Admins are auto-validated
                        adminClients.add(ws);
                        clearTimeout(validationTimeout); // Clear timeout on successful auth
                        console.log('Admin authenticated');
                    }
                    ws.send(JSON.stringify({ 
                        type: 'admin-auth-result', 
                        success,
                        settings: success ? currentSettings : null,
                        blockedIps: success ? Array.from(blockedIps) : null
                    }));
                    if (!success) {
                        // Close connection after failed admin auth
                        clearTimeout(validationTimeout);
                        setTimeout(() => {
                            try { ws.close(1008, 'Invalid admin password'); } catch (_) {}
                        }, 100);
                    }
                    return;
                }

                // All other message types require session validation
                if (!ws.sessionValidated) {
                    ws.send(JSON.stringify({ type: 'error', error: 'session_not_validated' }));
                    return;
                }
                
                // Regular message
                if (msg.type === 'message' && msg.user && msg.text) {
                    // Blocked IPs cannot send messages
                    if (ws.clientIp && blockedIps.has(ws.clientIp)) {
                        const now = new Date().toISOString();
                        writeChatLog({
                            type: 'message-rejected',
                            sessionCode,
                            timestamp: now,
                            reason: 'ip-blocked',
                            ip: ws.clientIp,
                            user: msg.user,
                            text: msg.text
                        });
                        try {
                            ws.send(JSON.stringify({ type: 'blocked', reason: 'ip-blocked' }));
                        } catch (_) {}
                        return;
                    }

                    // Slow mode check (per IP, skip for admins)
                    if (currentSettings.slowModeEnabled && ws.clientIp && !ws.isAdmin) {
                        const nowMs = Date.now();
                        const lastTime = lastMessageTimeByIp.get(ws.clientIp) || 0;
                        const cooldownMs = (currentSettings.slowModeSeconds || 3) * 1000;
                        const remaining = Math.ceil((cooldownMs - (nowMs - lastTime)) / 1000);
                        if (nowMs - lastTime < cooldownMs) {
                            try {
                                ws.send(JSON.stringify({ 
                                    type: 'slow-mode', 
                                    remainingSeconds: remaining,
                                    cooldownSeconds: currentSettings.slowModeSeconds || 3
                                }));
                            } catch (_) {}
                            return;
                        }
                    }

                    // Enforce per-message max words across all users/clients
                    const limitedText = truncateToMaxWords(msg.text, MAX_WORDS_PER_MESSAGE);
                    if (!limitedText) return;
                    msg.text = limitedText;

                    const msgId = ++messageIdCounter;
                    const now = new Date().toISOString();
                    const entry = {
                        id: msgId,
                        user: msg.user,
                        text: msg.text,
                        ip: ws.clientIp || null,
                        timestamp: now
                    };
                    messageIndex.set(msgId, entry);
                    
                    // Update last message time for slow mode
                    if (ws.clientIp) {
                        lastMessageTimeByIp.set(ws.clientIp, Date.now());
                    }
                    writeChatLog({
                        type: 'message',
                        sessionCode,
                        ...entry
                    });
                    
                    // Forward message to overlay with ID
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('new-message', { id: msgId, user: msg.user, text: msg.text });
                    }
                    
                    // Broadcast to all connected clients (for multi-user support)
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            try {
                                client.send(JSON.stringify({ type: 'message', id: msgId, user: msg.user, text: msg.text }));
                            } catch (err) {
                                console.error('Error sending message to client:', err);
                            }
                        }
                    });
                }
                
                
                // Admin: delete message
                else if (msg.type === 'admin-delete-msg' && ws.isAdmin) {
                    const now = new Date().toISOString();
                    const original = messageIndex.get(msg.msgId);
                    writeChatLog({
                        type: 'message-deleted',
                        sessionCode,
                        msgId: msg.msgId,
                        deletedAt: now,
                        deletedByIp: ws.clientIp || null,
                        // If we have the original message, include it and mark deleted.
                        original: original ? { ...original, deleted: true, deletedAt: now } : null
                    });
                    if (original) messageIndex.set(msg.msgId, { ...original, deleted: true, deletedAt: now });

                    // Auto-block: if the sender's IP has had 2 messages deleted this session
                    const senderIp = original?.ip ? normalizeIp(original.ip) : null;
                    if (senderIp) {
                        const next = (deletionsByIp.get(senderIp) || 0) + 1;
                        deletionsByIp.set(senderIp, next);
                        if (next >= 2) {
                            blockIp(senderIp, {
                                reason: 'auto-two-deletions',
                                triggeredByMsgId: msg.msgId,
                                triggeredByAdminIp: ws.clientIp || null
                            });
                        }
                    }

                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('delete-message', { id: msg.msgId });
                    }
                    // Notify ALL connected clients (not just admins)
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            try {
                                client.send(JSON.stringify({ type: 'message-deleted', msgId: msg.msgId }));
                            } catch (err) {
                                console.error('Error sending delete notification:', err);
                            }
                        }
                    });
                }
                
                // Admin: update settings
                else if (msg.type === 'admin-settings' && ws.isAdmin) {
                    // Update tracked settings
                    if (msg.maxMessages !== undefined) currentSettings.maxMessages = msg.maxMessages;
                    if (msg.fontSize !== undefined) currentSettings.fontSize = msg.fontSize;
                    if (msg.showJoinCode !== undefined) currentSettings.showJoinCode = msg.showJoinCode;
                    if (msg.showMobileLink !== undefined) currentSettings.showMobileLink = msg.showMobileLink;
                    if (msg.disableChatHistory !== undefined) currentSettings.disableChatHistory = msg.disableChatHistory;
                    if (msg.hideIp !== undefined) currentSettings.hideIp = !!msg.hideIp;
                    if (msg.customEmoji !== undefined) {
                        const next = String(msg.customEmoji || '').trim().slice(0, 8);
                        currentSettings.customEmoji = next || '⭐';
                    }
                    if (msg.emojiDirectSend !== undefined) currentSettings.emojiDirectSend = !!msg.emojiDirectSend;
                    if (msg.slowModeEnabled !== undefined) currentSettings.slowModeEnabled = !!msg.slowModeEnabled;
                    if (msg.slowModeSeconds !== undefined) {
                        const secs = parseInt(msg.slowModeSeconds, 10);
                        if (Number.isFinite(secs) && secs >= 1 && secs <= 60) {
                            currentSettings.slowModeSeconds = secs;
                        }
                    }
                    if (msg.enableFeedbackForm !== undefined) {
                        setFeedbackEnabled(!!msg.enableFeedbackForm, {
                            triggeredByAdminIp: ws.clientIp || null,
                            via: 'mobile-admin'
                        });
                    }
                    
                    // Send to overlay
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('settings-update', currentSettings);
                    }
                    
                    // Broadcast settings to ALL clients (for mobile link display)
                    const urls = getUrls();
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            try {
                                client.send(JSON.stringify({ 
                                    type: 'settings-sync', 
                                    settings: currentSettings,
                                    mobileUrl: urls.mobileUrl,
                                    wsUrl: urls.wsUrl
                                }));
                            } catch (err) {
                                console.error('Error sending settings to client:', err);
                            }
                        }
                    });
                    console.log('Settings updated:', currentSettings);
                }

                // Admin: manually block IP
                else if (msg.type === 'admin-block-ip' && ws.isAdmin) {
                    const ok = blockIp(msg.ip, {
                        reason: msg.reason || 'manual',
                        triggeredByAdminIp: ws.clientIp || null
                    });
                    ws.send(JSON.stringify({ type: 'admin-block-ip-result', success: ok, ip: normalizeIp(msg.ip) }));
                }

                // Admin: manually unblock IP
                else if (msg.type === 'admin-unblock-ip' && ws.isAdmin) {
                    const ok = unblockIp(msg.ip, {
                        reason: msg.reason || 'manual',
                        triggeredByAdminIp: ws.clientIp || null
                    });
                    ws.send(JSON.stringify({ type: 'admin-unblock-ip-result', success: ok, ip: normalizeIp(msg.ip) }));
                }
            } catch (e) {
                console.error('Invalid message:', e);
            }
        });
        
        ws.on('close', () => {
            clearTimeout(validationTimeout);
            adminClients.delete(ws);
            // Only log disconnections for validated clients to reduce noise
            if (ws.sessionValidated) {
                console.log('Client disconnected', clientIp ? `(${clientIp})` : '');
            }
        });
        
        ws.on('error', (err) => {
            console.error('WebSocket error:', err);
            adminClients.delete(ws);
        });
    });
    
    console.log(`WebSocket server running on port ${WS_PORT}`);
}

// Get local IP addresses
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// Get URLs based on hideIp setting
function getUrls() {
    const localIP = getLocalIP();
    const useCloudflare = currentSettings.hideIp && httpTunnel && wsTunnel;
    
    return {
        mobileUrl: useCloudflare ? `${httpTunnel.url}?s=${sessionCode}` : `http://${localIP}:${WS_PORT + 1}?s=${sessionCode}`,
        adminUrl: useCloudflare ? `${httpTunnel.url}/admin?s=${sessionCode}` : `http://${localIP}:${WS_PORT + 1}/admin?s=${sessionCode}`,
        wsUrl: useCloudflare ? wsTunnel.url : `ws://${localIP}:${WS_PORT}`
    };
}

// Start Cloudflare quick tunnel process and parse URL from output
function startCloudflareTunnel(port, tunnelType) {
    return new Promise((resolve, reject) => {
        const process = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        let errorOutput = '';
        let resolved = false;
        let timeoutId = null;

        const checkForUrl = (text) => {
            // Look for URL in output: "https://random-subdomain.trycloudflare.com"
            const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
            if (urlMatch && urlMatch.length > 0 && !resolved) {
                resolved = true;
                const url = urlMatch[0];
                console.log(`Cloudflare ${tunnelType} tunnel: ${url}`);
                if (timeoutId) clearTimeout(timeoutId);
                resolve({ process, url });
            }
        };

        process.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            checkForUrl(text);
        });

        process.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            // Cloudflare often outputs the URL to stderr
            checkForUrl(text);
        });

        process.on('error', (err) => {
            if (resolved) return;
            if (timeoutId) clearTimeout(timeoutId);
            if (err.code === 'ENOENT') {
                reject(new Error('cloudflared not found. Please install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'));
            } else {
                reject(err);
            }
        });

        process.on('exit', (code) => {
            if (resolved) return;
            if (timeoutId) clearTimeout(timeoutId);
            if (code !== 0 && code !== null) {
                reject(new Error(`cloudflared exited with code ${code}: ${errorOutput || output}`));
            }
        });

        // Timeout after 15 seconds if no URL found
        timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                process.kill();
                reject(new Error(`Timeout waiting for ${tunnelType} tunnel URL`));
            }
        }, 15000);
    });
}

// Broadcast tunnel URLs to all connected clients
function broadcastTunnelUrls() {
    if (!wss) return;
    const urls = getUrls();
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.sessionValidated) {
            try {
                client.send(JSON.stringify({ 
                    type: 'settings-sync', 
                    settings: currentSettings,
                    mobileUrl: urls.mobileUrl,
                    wsUrl: urls.wsUrl
                }));
            } catch (err) {
                console.error('Error broadcasting tunnel URLs to client:', err);
            }
        }
    });
}

// Create secure tunnels for internet access using Cloudflare quick tunnels
async function createTunnels() {
    try {
        // Create WebSocket tunnel FIRST (needed for HTTP tunnel pages)
        try {
            const wsResult = await startCloudflareTunnel(WS_PORT, 'WebSocket');
            wsTunnelProcess = wsResult.process;
            wsTunnel = { url: wsResult.url.replace('https://', 'wss://') };
            console.log(`Cloudflare WebSocket: ${wsTunnel.url}`);
        } catch (err) {
            console.error('Failed to create WebSocket tunnel:', err.message);
            wsTunnel = null;
        }

        // Create tunnel for HTTP server (mobile/admin pages) AFTER WebSocket tunnel
        try {
            const httpResult = await startCloudflareTunnel(WS_PORT + 1, 'HTTP');
            httpTunnelProcess = httpResult.process;
            httpTunnel = { url: httpResult.url };
            console.log(`Cloudflare Mobile URL: ${httpTunnel.url}?s=${sessionCode}`);
            console.log(`Cloudflare Admin URL: ${httpTunnel.url}/admin?s=${sessionCode}`);
        } catch (err) {
            console.error('Failed to create HTTP tunnel:', err.message);
            httpTunnel = null;
        }

        if (!httpTunnel && !wsTunnel) {
            console.log('Falling back to local network only');
        } else {
            // Broadcast updated tunnel URLs to all connected clients
            broadcastTunnelUrls();
        }
    } catch (err) {
        console.error('Failed to create tunnels:', err.message);
        console.log('Falling back to local network only');
    }
}

app.whenReady().then(async () => {
    // Register hotkeys before window creation (important for Linux)
    globalShortcut.register('CommandOrControl+Shift+O', toggleMode);
    globalShortcut.register('F9', toggleMode);

    // Start per-session chat logging
    initChatLogging();

    setTimeout(createWindow, 300);
    
    // Start servers
    createWebSocketServer();
    createHttpServer();
    
    // Create secure tunnels for internet access
    await createTunnels();
    
    const localIP = getLocalIP();
    console.log('Overlay started. Press Ctrl+Shift+O or F9 to toggle mode.');
    console.log(`Session Code: ${sessionCode}`);
    console.log(`Admin Password: ${adminPassword}`);
    if (httpTunnel && wsTunnel) {
        console.log('--- Cloudflare Tunnel URLs (Primary) ---');
        console.log(`Mobile app: ${httpTunnel.url}?s=${sessionCode}`);
        console.log(`Admin page: ${httpTunnel.url}/admin?s=${sessionCode}`);
        console.log(`WebSocket: ${wsTunnel.url}`);
    }
    console.log('--- Local Network URLs (Fallback) ---');
    console.log(`Mobile app: http://${localIP}:${WS_PORT + 1}?s=${sessionCode}`);
    console.log(`Admin page: http://${localIP}:${WS_PORT + 1}/admin?s=${sessionCode}`);
    console.log(`WebSocket: ws://${localIP}:${WS_PORT}`);
});

// IPC handlers
ipcMain.on('close-app', () => app.quit());
ipcMain.on('enter-passive', () => {
    if (!isPassive) toggleMode();
});

ipcMain.handle('get-session-info', () => {
    const localIP = getLocalIP();
    const urls = getUrls();
    
    const info = {
        code: sessionCode,
        adminPassword: adminPassword,
        wsUrl: urls.wsUrl,
        mobileUrl: urls.mobileUrl,
        adminUrl: urls.adminUrl
    };
    
    // Keep local URLs as fallback
    info.localWsUrl = `ws://${localIP}:${WS_PORT}`;
    info.localMobileUrl = `http://${localIP}:${WS_PORT + 1}?s=${sessionCode}`;
    info.localAdminUrl = `http://${localIP}:${WS_PORT + 1}/admin?s=${sessionCode}`;
    
    return info;
});

// Handle settings changes from overlay UI
ipcMain.on('settings-changed', (_, settings) => {
    if (settings.maxMessages !== undefined) currentSettings.maxMessages = settings.maxMessages;
    if (settings.fontSize !== undefined) currentSettings.fontSize = settings.fontSize;
    if (settings.showJoinCode !== undefined) currentSettings.showJoinCode = settings.showJoinCode;
    if (settings.showMobileLink !== undefined) currentSettings.showMobileLink = settings.showMobileLink;
    if (settings.disableChatHistory !== undefined) currentSettings.disableChatHistory = settings.disableChatHistory;
    if (settings.hideIp !== undefined) currentSettings.hideIp = !!settings.hideIp;
    if (settings.customEmoji !== undefined) {
        const next = String(settings.customEmoji || '').trim().slice(0, 8);
        currentSettings.customEmoji = next || '⭐';
    }
    if (settings.emojiDirectSend !== undefined) currentSettings.emojiDirectSend = !!settings.emojiDirectSend;
    if (settings.slowModeEnabled !== undefined) currentSettings.slowModeEnabled = !!settings.slowModeEnabled;
    if (settings.slowModeSeconds !== undefined) {
        const secs = parseInt(settings.slowModeSeconds, 10);
        if (Number.isFinite(secs) && secs >= 1 && secs <= 60) {
            currentSettings.slowModeSeconds = secs;
        }
    }
    if (settings.enableFeedbackForm !== undefined) {
        setFeedbackEnabled(!!settings.enableFeedbackForm, {
            via: 'overlay-settings'
        });
    }
    
    // Broadcast settings to ALL clients
    const urls = getUrls();
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify({ 
                    type: 'settings-sync', 
                    settings: currentSettings,
                    mobileUrl: urls.mobileUrl,
                    wsUrl: urls.wsUrl
                }));
            } catch (err) {
                console.error('Error sending settings to client:', err);
            }
        }
    });
});

ipcMain.on('window-move', (_, { deltaX, deltaY }) => {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + deltaX, y + deltaY);
});

ipcMain.on('window-resize', (_, { width, height, x, y }) => {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
        x: x !== undefined ? x : bounds.x,
        y: y !== undefined ? y : bounds.y,
        width: Math.max(200, width),
        height: Math.max(150, height)
    });
});

ipcMain.handle('get-window-bounds', () => mainWindow.getBounds());

// Cleanup function to properly close all servers and connections
function cleanup() {
    console.log('Cleaning up...');
    
    // Unregister shortcuts
    globalShortcut.unregisterAll();
    
    // Close all WebSocket connections first
    if (wss) {
        wss.clients.forEach(client => {
            try {
                client.terminate();
            } catch (e) {}
        });
        wss.close(() => {
            console.log('WebSocket server closed');
        });
        wss = null;
    }
    
    // Close HTTP server
    if (httpServer) {
        httpServer.close(() => {
            console.log('HTTP server closed');
        });
        httpServer = null;
    }
    
    // Close Cloudflare tunnels
    if (httpTunnelProcess) {
        try {
            httpTunnelProcess.kill();
        } catch (e) {
            console.error('Error killing HTTP tunnel process:', e);
        }
        httpTunnelProcess = null;
    }
    if (wsTunnelProcess) {
        try {
            wsTunnelProcess.kill();
        } catch (e) {
            console.error('Error killing WebSocket tunnel process:', e);
        }
        wsTunnelProcess = null;
    }
    httpTunnel = null;
    wsTunnel = null;
    
    // Clear admin clients
    adminClients.clear();

    // Close chat log stream
    closeChatLogging();

    // Close feedback log stream
    closeFeedbackLogging();
}

// Handle all quit scenarios
app.on('before-quit', cleanup);
app.on('will-quit', cleanup);
app.on('window-all-closed', () => {
    cleanup();
    app.quit();
});

// Handle unexpected exits
process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
});
process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    cleanup();
    process.exit(1);
});
