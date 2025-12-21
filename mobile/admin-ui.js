
// This script is loaded dynamically after admin authentication.
// It assumes window.$, window.escapeHtml, window.getUserColor, and window.chatClient are available.

// State variables declared in function scope created by new Function()

// --- State ---
let messages = new Map(); // msgId -> {user, text}
let isApplyingSettings = false;
let blockedIps = [];
const DEFAULT_CUSTOM_EMOJI = '⭐';
let customEmoji = DEFAULT_CUSTOM_EMOJI;
let emojiDirectSend = true;
let slowModeEnabled = false;
let slowModeSeconds = 3;
let adminEmojiTouchHandled = false;

// --- Elements ---
let messagesList, hideIpToggle, maxMsgSlider, maxMsgValue, fontSizeSlider, fontSizeValue;
let showJoinCodeToggle, showMobileLinkToggle, disableChatHistoryToggle, enableFeedbackFormToggle;
let customEmojiInput, customEmojiSetBtn, customEmojiCurrent, emojiDirectSendToggle;
let slowModeEnabledToggle, slowModeSlider, slowModeValue, slowModeSecondsGroup;
let blockedIpsList, adminUsername, adminMsgInput, adminSendBtn, adminEmojiBar, adminCustomEmojiBtn;

// Cee Agent Elements
let enableCeeAgentToggle, ceeApiKeyGroup, ceeApiKeyInput, ceeApiKeyToggle;
let ceeApiKeyStatusIndicator, ceeApiProviderSelect, ceeApiKeyLabel, ceeSystemPromptInput;

// Remote Control Elements & State
let touchPad, remoteKeyboardInput;
let touchState = { touches: [], lastTap: 0, tapCount: 0, isDragging: false, longPressTimer: null, isLongPress: false };
let mouseSensitivity = parseFloat(localStorage.getItem('remote_mouse_sensitivity')) || 1.5;
let scrollSpeed = parseInt(localStorage.getItem('remote_scroll_speed')) || 3;
let invertScroll = localStorage.getItem('remote_invert_scroll') === 'true';

// --- Initialization ---

// Explicitly grab globals
const $ = window.$;
const escapeHtml = window.escapeHtml;
const getUserColor = window.getUserColor;

window.initAdminUI = function () {
    console.log('Initializing Admin UI...');
    // alert('Admin UI Initializing...'); // Debug: Uncomment if needed
    try {
        findElements();
        attachListeners();
        renderMessages();

        // Expose handler for incoming messages
        window.handleAdminMessage = handleServerMessage;
        window.resetAdminState = resetState;

        // Mode toggle button logic
        const modeToggleBtn = $('mode-toggle-btn');
        if (modeToggleBtn) {
            modeToggleBtn.onclick = () => {
                if (window.chatClient) window.chatClient.send({ type: 'admin-toggle-mode' });
            };
        }
        console.log('Admin UI Initialized Successfully');
    } catch (e) {
        console.error('Error initializing Admin UI:', e);
        alert('Error initializing Admin UI: ' + e.message);
    }
};

function findElements() {
    // debug
    // alert('Admin UI: Finding elements...');
    messagesList = $('messages-list');
    adminUsername = $('admin-username');
    adminMsgInput = $('admin-msg-input');

    hideIpToggle = $('hideIp');
    // alert('hideIp found: ' + (hideIpToggle ? 'yes' : 'no') + ', messagesList: ' + (messagesList ? 'yes' : 'no'));

    adminSendBtn = $('admin-send-btn');
    adminEmojiBar = $('admin-emoji-bar');
    adminCustomEmojiBtn = $('admin-custom-emoji-btn');

    maxMsgSlider = $('maxMsgSlider');
    maxMsgValue = $('maxMsgValue');
    fontSizeSlider = $('fontSizeSlider');
    fontSizeValue = $('fontSizeValue');
    showJoinCodeToggle = $('showJoinCode');
    showMobileLinkToggle = $('showMobileLink');
    disableChatHistoryToggle = $('disableChatHistory');
    enableFeedbackFormToggle = $('enableFeedbackForm');
    customEmojiInput = $('customEmojiInput');
    customEmojiSetBtn = $('customEmojiSetBtn');
    customEmojiCurrent = $('customEmojiCurrent');
    emojiDirectSendToggle = $('emojiDirectSend');
    slowModeEnabledToggle = $('slowModeEnabled');
    slowModeSlider = $('slowModeSlider');
    slowModeValue = $('slowModeValue');
    slowModeSecondsGroup = $('slowModeSecondsGroup');
    blockedIpsList = $('blocked-ips-list');

    enableCeeAgentToggle = $('enableCeeAgent');
    ceeApiKeyGroup = $('ceeApiKeyGroup');
    ceeApiKeyInput = $('cee-api-key');
    ceeApiKeyToggle = $('cee-api-key-toggle');
    ceeApiKeyStatusIndicator = $('ceeApiKeyStatusIndicator');
    ceeApiProviderSelect = $('ceeApiProvider');
    ceeApiKeyLabel = $('ceeApiKeyLabel');
    ceeSystemPromptInput = $('ceeSystemPrompt');

    // Remote Control
    touchPad = $('touch-pad');
    remoteKeyboardInput = $('remote-keyboard-input');

    // Set initial values from localStorage for admin name
    if (adminUsername) adminUsername.value = localStorage.getItem('livechat_admin_name') || 'Admin';
}

function attachListeners() {
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            $('tab-' + tab.dataset.tab).classList.add('active');
        };
    });

    // Emoji Bar
    if (adminEmojiBar) {
        adminEmojiBar.addEventListener('touchend', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('button[data-emoji]') : null;
            if (!btn) return;
            e.preventDefault(); e.stopPropagation();
            adminEmojiTouchHandled = true;
            processAdminEmoji(btn.dataset.emoji);
            setTimeout(() => { adminEmojiTouchHandled = false; }, 100);
        }, { passive: false });

        adminEmojiBar.addEventListener('click', (e) => {
            if (adminEmojiTouchHandled) return;
            const btn = e.target && e.target.closest ? e.target.closest('button[data-emoji]') : null;
            if (!btn) return;
            e.preventDefault(); e.stopPropagation();
            processAdminEmoji(btn.dataset.emoji);
        });
        adminEmojiBar.addEventListener('touchstart', (e) => {
            if (e.target && e.target.closest && e.target.closest('button[data-emoji]')) e.preventDefault();
        }, { passive: false });
    }

    if (customEmojiSetBtn) customEmojiSetBtn.onclick = commitCustomEmojiChange;
    if (customEmojiInput) customEmojiInput.onkeypress = (e) => { if (e.key === 'Enter') commitCustomEmojiChange(); };

    if (adminSendBtn) adminSendBtn.onclick = sendAdminMessage;
    if (adminMsgInput) adminMsgInput.onkeypress = (e) => { if (e.key === 'Enter') sendAdminMessage(); };

    // Settings Listeners
    if (hideIpToggle) hideIpToggle.onchange = () => !isApplyingSettings && sendSettings({ hideIp: hideIpToggle.checked });
    if (maxMsgSlider) maxMsgSlider.oninput = () => { if (!isApplyingSettings) { maxMsgValue.textContent = maxMsgSlider.value; sendSettings({ maxMessages: parseInt(maxMsgSlider.value) }); } };
    if (fontSizeSlider) fontSizeSlider.oninput = () => { if (!isApplyingSettings) { fontSizeValue.textContent = fontSizeSlider.value; sendSettings({ fontSize: parseInt(fontSizeSlider.value) }); } };
    if (showJoinCodeToggle) showJoinCodeToggle.onchange = () => !isApplyingSettings && sendSettings({ showJoinCode: showJoinCodeToggle.checked });
    if (showMobileLinkToggle) showMobileLinkToggle.onchange = () => !isApplyingSettings && sendSettings({ showMobileLink: showMobileLinkToggle.checked });
    if (disableChatHistoryToggle) disableChatHistoryToggle.onchange = () => !isApplyingSettings && sendSettings({ disableChatHistory: disableChatHistoryToggle.checked });
    if (enableFeedbackFormToggle) enableFeedbackFormToggle.onchange = () => !isApplyingSettings && sendSettings({ enableFeedbackForm: enableFeedbackFormToggle.checked });

    if (emojiDirectSendToggle) emojiDirectSendToggle.onchange = () => {
        if (!isApplyingSettings) { emojiDirectSend = emojiDirectSendToggle.checked; sendSettings({ emojiDirectSend }); }
    };

    if (slowModeEnabledToggle) slowModeEnabledToggle.onchange = () => {
        if (!isApplyingSettings) {
            slowModeEnabled = slowModeEnabledToggle.checked;
            if (slowModeSecondsGroup) slowModeSecondsGroup.style.display = slowModeEnabled ? 'block' : 'none';
            sendSettings({ slowModeEnabled });
        }
    };

    if (slowModeSlider) slowModeSlider.oninput = () => {
        if (!isApplyingSettings) {
            slowModeSeconds = parseInt(slowModeSlider.value) || 3;
            slowModeValue.textContent = slowModeSeconds;
            sendSettings({ slowModeSeconds });
        }
    };

    // Cee Agent Listeners
    if (ceeApiProviderSelect) ceeApiProviderSelect.onchange = () => {
        if (isApplyingSettings) return;
        const p = ceeApiProviderSelect.value;
        updateCeeApiProviderUI(p);
        if (ceeApiKeyInput) { ceeApiKeyInput.value = ''; updateCeeApiKeyStatusIndicator(false); }
        sendSettings({ ceeApiProvider: p, ceeApiKey: '' });
    };
    if (enableCeeAgentToggle) enableCeeAgentToggle.onchange = () => {
        if (isApplyingSettings) return;
        updateCeeApiKeyVisibility();
        sendSettings({ enableCeeAgent: enableCeeAgentToggle.checked });
    };
    if (ceeApiKeyInput) {
        let to = null;
        ceeApiKeyInput.oninput = () => { clearTimeout(to); to = setTimeout(() => { const k = ceeApiKeyInput.value.trim(); sendSettings({ ceeApiKey: k }); updateCeeApiKeyStatusIndicator(!!k); }, 500); };
        ceeApiKeyInput.onblur = () => { clearTimeout(to); const k = ceeApiKeyInput.value.trim(); sendSettings({ ceeApiKey: k }); updateCeeApiKeyStatusIndicator(!!k); };
    }
    if (ceeApiKeyToggle) {
        let visible = false;
        ceeApiKeyToggle.onclick = () => { visible = !visible; ceeApiKeyInput.type = visible ? 'text' : 'password'; ceeApiKeyToggle.textContent = visible ? 'Hide' : 'Show'; };
    }
    if (ceeSystemPromptInput) {
        let to = null;
        ceeSystemPromptInput.oninput = () => { clearTimeout(to); to = setTimeout(() => { sendSettings({ ceeSystemPrompt: ceeSystemPromptInput.value.trim() }); }, 500); };
        ceeSystemPromptInput.onblur = () => { clearTimeout(to); sendSettings({ ceeSystemPrompt: ceeSystemPromptInput.value.trim() }); };
    }

    // Remote Control Listeners
    const remoteControlBtn = $('remote-control-btn');
    const remotePanel = $('remote-panel');
    const remoteCloseBtn = $('remote-close-btn');
    const remoteSettingsBtn = $('remote-settings-btn');
    const remoteSettingsOverlay = $('remote-settings-overlay');
    const settingsCloseBtn = $('settings-close-btn');

    if (remoteControlBtn) remoteControlBtn.onclick = () => {
        if (!window.chatClient || !window.chatClient.ws) return alert('Not connected');
        remotePanel.classList.add('visible');
        remoteControlBtn.classList.add('active');
        sendRemote('remote-control-start');
    };
    if (remoteCloseBtn) remoteCloseBtn.onclick = () => {
        remotePanel.classList.remove('visible');
        remoteControlBtn.classList.remove('active');
        sendRemote('remote-control-end');
    };
    if (remoteSettingsBtn) remoteSettingsBtn.onclick = () => remoteSettingsOverlay.classList.add('visible');
    if (settingsCloseBtn) settingsCloseBtn.onclick = () => remoteSettingsOverlay.classList.remove('visible');

    // Remote Settings
    const mouseSensitivitySlider = $('mouse-sensitivity');
    const scrollSpeedSlider = $('scroll-speed');
    const invertScrollCheckbox = $('invert-scroll');

    if (mouseSensitivitySlider) {
        mouseSensitivitySlider.value = mouseSensitivity;
        mouseSensitivitySlider.oninput = (e) => { mouseSensitivity = parseFloat(e.target.value); localStorage.setItem('remote_mouse_sensitivity', mouseSensitivity); };
    }
    if (scrollSpeedSlider) {
        scrollSpeedSlider.value = scrollSpeed;
        scrollSpeedSlider.oninput = (e) => { scrollSpeed = parseInt(e.target.value); localStorage.setItem('remote_scroll_speed', scrollSpeed); };
    }
    if (invertScrollCheckbox) {
        invertScrollCheckbox.checked = invertScroll;
        invertScrollCheckbox.onchange = (e) => { invertScroll = e.target.checked; localStorage.setItem('remote_invert_scroll', invertScroll); };
    }

    // Remote Tabs
    document.querySelectorAll('.remote-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.remote-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.remote-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetId = 'remote-' + tab.dataset.remoteTab;
            const target = $(targetId);
            if (target) target.classList.add('active');
        };
    });

    // Touchpad
    if (touchPad) {
        touchPad.addEventListener('touchstart', handleTouchStart, { passive: false });
        touchPad.addEventListener('touchmove', handleTouchMove, { passive: false });
        touchPad.addEventListener('touchend', handleTouchEnd, { passive: false });
        touchPad.addEventListener('touchcancel', handleTouchCancel);
    }

    // Mouse Buttons
    const mouseLeftBtn = $('mouse-left-btn');
    const mouseRightBtn = $('mouse-right-btn');
    if (mouseLeftBtn) mouseLeftBtn.onclick = () => { sendRemote('remote-mouse-click', { button: 'left' }); if (navigator.vibrate) navigator.vibrate(10); };
    if (mouseRightBtn) mouseRightBtn.onclick = () => { sendRemote('remote-mouse-click', { button: 'right' }); if (navigator.vibrate) navigator.vibrate([10, 50, 10]); };

    // Keyboard
    if (remoteKeyboardInput) {
        remoteKeyboardInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (remoteKeyboardInput.value) {
                    sendRemote('remote-keyboard-type', { text: remoteKeyboardInput.value });
                    remoteKeyboardInput.value = '';
                }
                sendRemote('remote-keyboard-key', { key: 'Enter' });
            }
        };
    }
    // Special Keys
    document.querySelectorAll('.key-btn[data-key]').forEach(btn => {
        btn.onclick = () => { sendRemote('remote-keyboard-key', { key: btn.dataset.key }); if (navigator.vibrate) navigator.vibrate(10); };
    });
    // Media
    const mediaPrevBtn = $('media-prev-btn');
    const mediaPlayBtn = $('media-play-btn');
    const mediaNextBtn = $('media-next-btn');
    const mediaSeekBackBtn = $('media-seek-back-btn');
    const mediaSeekForwardBtn = $('media-seek-forward-btn');
    const volDownBtn = $('vol-down-btn');
    const volMuteBtn = $('vol-mute-btn');
    const volUpBtn = $('vol-up-btn');

    if (mediaPrevBtn) mediaPrevBtn.onclick = () => sendRemote('remote-media', { action: 'prev' });
    if (mediaPlayBtn) mediaPlayBtn.onclick = () => sendRemote('remote-media', { action: 'play' });
    if (mediaNextBtn) mediaNextBtn.onclick = () => sendRemote('remote-media', { action: 'next' });
    if (mediaSeekBackBtn) mediaSeekBackBtn.onclick = () => sendRemote('remote-keyboard-key', { key: 'ArrowLeft' });
    if (mediaSeekForwardBtn) mediaSeekForwardBtn.onclick = () => sendRemote('remote-keyboard-key', { key: 'ArrowRight' });
    if (volDownBtn) volDownBtn.onclick = () => sendRemote('remote-volume', { action: 'down' });
    if (volMuteBtn) volMuteBtn.onclick = () => sendRemote('remote-volume', { action: 'mute' });
    if (volUpBtn) volUpBtn.onclick = () => sendRemote('remote-volume', { action: 'up' });

    // Dpad
    document.querySelectorAll('.dpad-btn').forEach(btn => {
        btn.onclick = () => {
            const key = btn.dataset.key;
            if (key) { sendRemote('remote-keyboard-key', { key }); if (navigator.vibrate) navigator.vibrate(15); }
        };
    });

    // VLC
    document.querySelectorAll('.vlc-btn[data-vlc]').forEach(btn => {
        btn.onclick = () => { sendRemote('remote-vlc', { action: btn.dataset.vlc, value: btn.dataset.value }); if (navigator.vibrate) navigator.vibrate(10); };
    });
}

// --- Message Handling ---

function handleServerMessage(data) {
    if (data.type === 'message') {
        if (data.id !== undefined && data.user && data.text) addMessage(data.id, data.user, data.text);
    } else if (data.type === 'message-deleted') {
        if (data.msgId !== undefined) removeMessage(data.msgId);
    } else if (data.type === 'mode-state') {
        const mb = $('mode-toggle-btn');
        if (mb) {
            if (data.mode === 'passive') { mb.classList.add('passive'); mb.title = 'Active Mode (Currently Passive)'; }
            else { mb.classList.remove('passive'); mb.title = 'Passive Mode (Currently Active)'; }
        }
    } else if (data.type === 'settings-sync') {
        if (data.settings) applySettings(data.settings);
        // Autofill handling (same as before) logic omitted for brevity as it was mostly for login screen
    } else if (data.type === 'slow-mode') {
        // showSlowModeNotice... we need to implement or expose? 
        // We can just ignore for admin or implement a simple alert
    } else if (data.type === 'blocked-ips-update') {
        if (Array.isArray(data.blockedIps)) { blockedIps = data.blockedIps; renderBlockedIps(); }
    } else if (data.type === 'admin-unblock-ip-result') {
        if (!data.success) alert('Could not unblock IP.');
    } else if (data.type === 'remote-enabled-status') {
        const ap = $('admin-panel');
        if (ap) { data.enabled ? ap.classList.add('remote-enabled') : ap.classList.remove('remote-enabled'); }
    }
}

function resetState() {
    messages = new Map();
    if (messagesList) messagesList.innerHTML = '<div class="empty-state">No messages yet</div>';
    const ap = $('admin-panel');
    if (ap) ap.classList.remove('visible');
    const rp = $('remote-panel');
    if (rp) rp.classList.remove('visible');
    const rcb = $('remote-control-btn');
    if (rcb) rcb.classList.remove('active');
}

// --- Logic ---

function addMessage(id, user, text) {
    messages.set(id, { user, text });
    renderMessages();
}

function removeMessage(id) {
    messages.delete(id);
    renderMessages();
}

function renderMessages() {
    if (!messagesList) return;
    if (messages.size === 0) {
        messagesList.innerHTML = '<div class="empty-state">No messages yet</div>';
        return;
    }
    messagesList.innerHTML = '';
    const sortedMessages = [...messages.entries()].reverse();
    for (const [id, msg] of sortedMessages) {
        const el = document.createElement('div');
        el.className = 'msg-item';
        el.innerHTML = `
              <div class="content">
                <div class="user" style="color: ${window.getUserColor(msg.user)}">${window.escapeHtml(msg.user)}</div>
                <div class="text">${window.escapeHtml(msg.text)}</div>
              </div>
              <button class="delete-btn" data-id="${id}">🗑</button>
            `;
        el.querySelector('.delete-btn').onclick = () => deleteMessage(id);
        messagesList.appendChild(el);
    }
}

function deleteMessage(id) {
    if (window.chatClient) window.chatClient.send({ type: 'admin-delete-msg', msgId: id });
}

function applySettings(settings) {
    isApplyingSettings = true;
    if (settings.hideIp !== undefined && hideIpToggle) hideIpToggle.checked = settings.hideIp;
    if (settings.maxMessages !== undefined) { if (maxMsgSlider) maxMsgSlider.value = settings.maxMessages; if (maxMsgValue) maxMsgValue.textContent = settings.maxMessages; }
    if (settings.fontSize !== undefined) { if (fontSizeSlider) fontSizeSlider.value = settings.fontSize; if (fontSizeValue) fontSizeValue.textContent = settings.fontSize; }
    if (settings.showJoinCode !== undefined && showJoinCodeToggle) showJoinCodeToggle.checked = settings.showJoinCode;
    if (settings.showMobileLink !== undefined && showMobileLinkToggle) showMobileLinkToggle.checked = settings.showMobileLink;
    if (settings.disableChatHistory !== undefined && disableChatHistoryToggle) disableChatHistoryToggle.checked = settings.disableChatHistory;
    if (settings.enableFeedbackForm !== undefined && enableFeedbackFormToggle) enableFeedbackFormToggle.checked = settings.enableFeedbackForm;

    if (settings.customEmoji !== undefined) setCustomEmoji(settings.customEmoji);
    if (settings.emojiDirectSend !== undefined) {
        emojiDirectSend = !!settings.emojiDirectSend;
        if (emojiDirectSendToggle) emojiDirectSendToggle.checked = emojiDirectSend;
    }
    if (settings.slowModeEnabled !== undefined) {
        slowModeEnabled = !!settings.slowModeEnabled;
        if (slowModeEnabledToggle) slowModeEnabledToggle.checked = slowModeEnabled;
        if (slowModeSecondsGroup) slowModeSecondsGroup.style.display = slowModeEnabled ? 'block' : 'none';
    }
    if (settings.slowModeSeconds !== undefined) {
        slowModeSeconds = parseInt(settings.slowModeSeconds, 10) || 3;
        if (slowModeSlider) slowModeSlider.value = slowModeSeconds;
        if (slowModeValue) slowModeValue.textContent = slowModeSeconds;
    }

    if (settings.enableCeeAgent !== undefined && enableCeeAgentToggle) {
        enableCeeAgentToggle.checked = settings.enableCeeAgent;
        updateCeeApiKeyVisibility();
    }
    if (settings.ceeApiProvider !== undefined) updateCeeApiProviderUI(settings.ceeApiProvider);
    if (settings.ceeApiKeySet !== undefined) updateCeeApiKeyStatusIndicator(settings.ceeApiKeySet);
    if (settings.ceeSystemPrompt !== undefined && ceeSystemPromptInput) ceeSystemPromptInput.value = settings.ceeSystemPrompt;

    isApplyingSettings = false;
}

function sendSettings(settings) {
    if (window.chatClient) window.chatClient.send({ type: 'admin-settings', ...settings });
}

// --- Blocked IPs ---
function renderBlockedIps() {
    if (!blockedIpsList) return;
    if (blockedIps.length === 0) {
        blockedIpsList.innerHTML = '<div class="empty-state">No blocked IPs</div>';
        return;
    }
    blockedIpsList.innerHTML = '';
    blockedIps.forEach(ip => {
        const div = document.createElement('div');
        div.className = 'setting-row';
        // Reuse setting-row style for consistency
        div.style.justifyContent = 'space-between';
        div.innerHTML = `<span style="font-family:monospace">${window.escapeHtml(normalizeIp(ip))}</span>`;
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.style.width = 'auto'; btn.style.padding = '4px 12px'; btn.style.fontSize = '12px';
        btn.textContent = 'Unblock';
        btn.onclick = () => unblockIp(ip);
        div.appendChild(btn);
        blockedIpsList.appendChild(div);
    });
}
function normalizeIp(ip) { return String(ip || '').trim().replace(/^::ffff:/, ''); }
function unblockIp(ip) { if (window.chatClient) window.chatClient.send({ type: 'admin-unblock-ip', ip }); }

// --- Emoji & Chat ---
function setCustomEmoji(val) {
    customEmoji = (val || '').trim().slice(0, 8) || DEFAULT_CUSTOM_EMOJI;
    if (adminCustomEmojiBtn) { adminCustomEmojiBtn.textContent = customEmoji; adminCustomEmojiBtn.dataset.emoji = customEmoji; }
    if (customEmojiCurrent) customEmojiCurrent.textContent = customEmoji;
}
function commitCustomEmojiChange() {
    if (isApplyingSettings) return;
    const val = customEmojiInput ? customEmojiInput.value : '';
    setCustomEmoji(val);
    if (customEmojiInput) customEmojiInput.value = '';
    sendSettings({ customEmoji });
}
function processAdminEmoji(emoji) {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (emojiDirectSend) sendAdminText(emoji, false);
    else {
        if (adminMsgInput) {
            adminMsgInput.value = (adminMsgInput.value || '') + emoji;
        }
    }
}
function sendAdminMessage() {
    if (!adminMsgInput) return;
    const wasFocused = document.activeElement === adminMsgInput;
    sendAdminText(adminMsgInput.value, wasFocused);
}
function sendAdminText(text, shouldFocus) {
    const user = adminUsername ? adminUsername.value.trim() : 'Admin';
    localStorage.setItem('livechat_admin_name', user);
    if (!text.trim()) return;
    if (window.chatClient) window.chatClient.send({ type: 'message', user, text });
    if (adminMsgInput) adminMsgInput.value = '';
    if (shouldFocus && adminMsgInput) adminMsgInput.focus();
}

// --- Cee Agent Helpers ---
function updateCeeApiKeyVisibility() {
    if (ceeApiKeyGroup && enableCeeAgentToggle) ceeApiKeyGroup.style.display = enableCeeAgentToggle.checked ? 'block' : 'none';
}
function updateCeeApiKeyStatusIndicator(isSet) {
    if (ceeApiKeyStatusIndicator) {
        ceeApiKeyStatusIndicator.textContent = isSet ? 'API Key Set ✓' : 'Not Set';
        ceeApiKeyStatusIndicator.style.color = isSet ? 'rgba(255, 255, 255, 0.75)' : 'var(--danger)';
    }
}
function updateCeeApiProviderUI(provider) {
    const p = provider || 'openai';
    if (ceeApiKeyLabel) ceeApiKeyLabel.textContent = p === 'gemini' ? 'Gemini API Key' : 'OpenAI API Key';
    if (ceeApiKeyInput) ceeApiKeyInput.placeholder = p === 'gemini' ? 'AIza...' : 'sk-...';
    if (ceeApiProviderSelect) ceeApiProviderSelect.value = p;
}

// --- Remote Control Touch Helpers ---
function sendRemote(type, data = {}) { if (window.chatClient) window.chatClient.send({ type, ...data }); }

function handleTouchStart(e) {
    e.preventDefault();
    touchPad.classList.add('active');
    const touches = Array.from(e.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    touchState.touches = touches;
    if (touches.length === 1) {
        touchState.longPressTimer = setTimeout(() => {
            touchState.isLongPress = true;
            sendRemote('remote-mouse-down', { button: 'left' });
            if (navigator.vibrate) navigator.vibrate(50);
        }, 500);
    }
}
function handleTouchMove(e) {
    e.preventDefault();
    if (touchState.longPressTimer) { clearTimeout(touchState.longPressTimer); touchState.longPressTimer = null; }
    const currentTouches = Array.from(e.touches);
    if (currentTouches.length === 1 && touchState.touches.length >= 1) {
        const touch = currentTouches[0];
        const prev = touchState.touches.find(t => t.id === touch.identifier) || touchState.touches[0];
        const dx = (touch.clientX - prev.x) * mouseSensitivity;
        const dy = (touch.clientY - prev.y) * mouseSensitivity;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) sendRemote('remote-mouse-move', { deltaX: dx, deltaY: dy });
        touchState.touches = [{ id: touch.identifier, x: touch.clientX, y: touch.clientY }];
    } else if (currentTouches.length === 2 && touchState.touches.length >= 2) {
        const avgY = (currentTouches[0].clientY + currentTouches[1].clientY) / 2;
        const prevAvgY = (touchState.touches[0].y + touchState.touches[1].y) / 2;
        let dy = (avgY - prevAvgY) * scrollSpeed * 0.5;
        if (invertScroll) dy = -dy;
        if (Math.abs(dy) > 1) sendRemote('remote-scroll', { deltaX: 0, deltaY: Math.round(dy) });
        touchState.touches = currentTouches.map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    }
}
function handleTouchEnd(e) {
    e.preventDefault();
    touchPad.classList.remove('active');
    if (touchState.longPressTimer) { clearTimeout(touchState.longPressTimer); touchState.longPressTimer = null; }
    if (touchState.isLongPress) { sendRemote('remote-mouse-up', { button: 'left' }); touchState.isLongPress = false; }
    touchState.touches = [];
}
function handleTouchCancel() {
    touchPad.classList.remove('active');
    if (touchState.longPressTimer) clearTimeout(touchState.longPressTimer);
    if (touchState.isLongPress) sendRemote('remote-mouse-up', { button: 'left' });
    touchState = { touches: [], lastTap: 0, tapCount: 0, isDragging: false, longPressTimer: null, isLongPress: false };
}

// End of script
