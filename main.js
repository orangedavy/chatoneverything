const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');

let mainWindow;
let isPassive = true;

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

    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.loadFile('index.html');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
}

function toggleMode() {
    isPassive = !isPassive;
    
    mainWindow.setIgnoreMouseEvents(isPassive, { forward: isPassive });
    mainWindow.setFocusable(!isPassive);
    
    if (!isPassive) mainWindow.focus();
    
    mainWindow.webContents.send('mode-change', isPassive ? 'passive' : 'active');
    console.log(`Mode: ${isPassive ? 'Passive' : 'Active'}`);
}

app.whenReady().then(() => {
    // Register hotkeys before window creation (important for Linux)
    globalShortcut.register('CommandOrControl+Shift+O', toggleMode);
    globalShortcut.register('F9', toggleMode);

    setTimeout(createWindow, 300);
    console.log('Overlay started. Press Ctrl+Shift+O or F9 to toggle mode.');
});

// IPC handlers
ipcMain.on('close-app', () => app.quit());
ipcMain.on('enter-passive', () => {
    if (!isPassive) toggleMode();
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

app.on('will-quit', () => globalShortcut.unregisterAll());
