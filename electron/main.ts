import { app, BrowserWindow, ipcMain, nativeTheme, net, powerMonitor, shell } from 'electron';
import path from 'node:path';
import isDev from 'electron-is-dev';
import { fileURLToPath } from 'node:url';

import './ipc.js';
import { port } from './server.js';
import { catalog, poll, prepareAi, warmUpRumble } from './services.js';

const dirname = path.resolve(fileURLToPath(import.meta.url), '..');

let electronWindow: BrowserWindow | null = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
    title: 'GOT Vote',
    width: 1024,
    height: 768,
    frame: false,
    icon: path.resolve(dirname, '../assets/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 56,
      color: nativeTheme.shouldUseDarkColors ? '#00000000' : '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
    },
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.resolve(dirname, 'preload.mjs'),
      sandbox: false,
      webviewTag: true,
    },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
  });

  // This fixes and electron bug that shows a phantom title bar
  mainWindow.on('blur', () => {
    const [w, h] = mainWindow.getSize();
    mainWindow.setSize(w, h + 1);
    mainWindow.setSize(w, h);
  });
  mainWindow.on('focus', () => {
    mainWindow.setResizable(true);
    const [w, h] = mainWindow.getSize();
    mainWindow.setSize(w, h + 1);
    mainWindow.setSize(w, h);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonPosition({
      x: 12,
      y: 20,
    });
  }

  // Load the app
  if (isDev) {
    console.log('Loading from dev server');
    // In development, load from the dev server
    mainWindow.loadURL('http://localhost:5173');
    // Open DevTools
    mainWindow.webContents.openDevTools({
      mode: 'detach',
    });
  } else {
    // In production, load the built index.html
    mainWindow.loadURL(`http://localhost:${port}`);
    // mainWindow.webContents.openDevTools({
    //   mode: 'detach',
    // });
  }

  electronWindow = mainWindow;
  // helper windows (the hidden Rumble page) must not keep the app alive
  mainWindow.on('closed', () => {
    electronWindow = null;
    if (process.platform !== 'darwin') app.quit();
  });
}

ipcMain.handle('setTheme', (_, theme: 'light' | 'dark' | 'system') => {
  console.log('Setting theme to', theme);
  nativeTheme.themeSource = theme;
  if (process.platform === 'win32') {
    electronWindow?.setTitleBarOverlay({
      color: nativeTheme.shouldUseDarkColors ? '#00000000' : '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#000000',
      height: 56,
    });
  }
  return nativeTheme.shouldUseDarkColors;
});

ipcMain.handle('getServerPort', () => {
  return port;
});

app.whenReady().then(() => {
  createWindow();
  warmUpRumble();
  void prepareAi(); // load the selected AI strategy's models in the background

  // Sockets don't survive sleep or a network switch, and often don't notice
  // either. Reconnect every chat source the moment we're back.
  powerMonitor.on('resume', () => poll.kickSources('network change'));
  powerMonitor.on('unlock-screen', () => poll.kickSources('network change'));
  let online = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now && !online) poll.kickSources('network change');
    online = now;
  }, 3_000).unref();

  if (process.platform === 'win32') {
    electronWindow?.setBackgroundMaterial('acrylic');
  }

  app.on('activate', () => {
    if (!electronWindow) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  poll.stop();
  catalog.cancel(); // the partial file is discarded; the live catalog is untouched
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
