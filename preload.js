const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => {
        // Whitelist channels
        let validChannels = [
            'window-move',
            'window-resize',
            'enter-passive',
            'close-app',
            'settings-changed',
            'enable-remote-control',
            'disable-remote-control',
            'screenshot-result',
            'request-focus'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        let validChannels = [
            'mode-change',
            'new-message',
            'delete-message',
            'settings-update',
            'capture-screenshot',
            'open-settings'
        ];
        if (validChannels.includes(channel)) {
            // Strip event as it includes sender
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    invoke: (channel, data) => {
        let validChannels = [
            'get-window-bounds',
            'get-session-info',
            'get-screen-sources'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, data);
        }
    },
    removeListener: (channel, func) => {
        // implementation for removing listeners if needed, though 'on' wrapper makes it tricky. 
        // For now, straightforward usage doesn't typically remove listeners in this app.
        ipcRenderer.removeAllListeners(channel);
    },
    openExternal: (url) => shell.openExternal(url),
    copyToClipboard: (text) => clipboard.writeText(text)
});
