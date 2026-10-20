import { app, BrowserWindow, ipcMain, nativeTheme, net, powerMonitor, shell } from 'electron';
import path from 'node:path';
import isDev from 'electron-is-dev';
import { fileURLToPath } from 'node:url';

import './ipc.js';
import { port } from './server.js';
import { catalog, poll, prepareAi, user, warmUpRumble } from './services.js';
import { autoStartTunnel, stopTunnel } from './sharing.js';

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
    // the window stays transparent either way (that can't change at
    // runtime); with glass off the effect is dropped and the page paints a
    // solid background over it
    ...(user.settings().glass
      ? { vibrancy: 'under-window' as const, backgroundMaterial: 'mica' as const }
      : { backgroundMaterial: 'none' as const }),
    visualEffectState: 'active',
    backgroundColor: '#00000000',
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

/** Turn the OS blur behind the window on or off. */
function applyGlass(win: BrowserWindow | null, on: boolean) {
  if (!win || win.isDestroyed()) return;
  if (process.platform === 'darwin') win.setVibrancy(on ? 'under-window' : null);
  if (process.platform === 'win32') win.setBackgroundMaterial(on ? 'acrylic' : 'none');
}

ipcMain.handle('setGlass', (_, on: boolean) => {
  user.setSettings({ glass: !!on });
  applyGlass(electronWindow, !!on);
});

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
  autoStartTunnel();

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
    if (user.settings().glass) electronWindow?.setBackgroundMaterial('acrylic');
  }

  app.on('activate', () => {
    if (!electronWindow) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  poll.stop();
  catalog.cancelAll(); // partial files are discarded; live catalogs are untouched
  void stopTunnel(); // close the public link (and the cloudflared process)
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
