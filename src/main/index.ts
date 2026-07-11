import {
  app,
  BrowserWindow,
  shell,
  nativeTheme,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  ipcMain,
} from 'electron';
// import { autoUpdater } from 'electron-updater';\
import path from 'path';
import { setMainWindow } from './ipc-handlers.js';
import { closeBrowser, launchBrowser, isBrowserRunning } from './browser-manager.js';
import { automationOrchestrator } from './automation/index.js';
import { getGlobalShortcut, isProfileInitialized } from './storage.js';
import { startExtensionBridgeServer, stopExtensionBridgeServer } from './ext-server.js';

// __dirname is available natively in CJS (esbuild target: cjs)

const isDev = process.env.NODE_ENV === 'development';

// In dev, detect if we are the 2nd instance so we can load Vite on the next port.
// We store this before requestSingleInstanceLock so it's available in createWindow.
let devClientPort = 5173;

let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  // Create a minimal 16x16 monochrome icon in memory using raw PNG data.
  // In production, replace with a proper .ico / .png asset from your resources dir.
  const iconPath = isDev
    ? path.join(__dirname, '../../resources/tray-icon.png')
    : path.join(process.resourcesPath, 'tray-icon.png');

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    // Fallback: create a tiny transparent 16x16 icon from a minimal PNG buffer
    icon = nativeImage.createEmpty();
  }

  // On macOS, mark as template so it adapts to dark/light menu bar
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip('RemoteCtrl');
  updateTrayMenu();

  tray.on('click', () => {
    showWindow();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open RemoteCtrl',
      click: () => showWindow(),
    },
    {
      label: 'Start Local Session',
      click: async () => {
        showWindow();
        mainWindow?.webContents.send('app:startLocalSession');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function showWindow() {
  if (!mainWindow) {
    const win = createWindow();
    setMainWindow(win);
  } else if (mainWindow.isMinimized()) {
    mainWindow.restore();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow?.focus();
}

function getOrCreateMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;

  miniWindow = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#141415',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    miniWindow.loadURL(`http://localhost:${devClientPort}/?mini=true`);
  } else {
    miniWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { 'mini': 'true' } });
  }

  miniWindow.on('closed', () => {
    miniWindow = null;
  });

  return miniWindow;
}

function toggleMiniWindow() {
  const win = getOrCreateMiniWindow();
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
    win.webContents.send('app:globalShortcut');
  }
}

// ── Global Shortcut ───────────────────────────────────────────────────────────
function registerGlobalShortcut() {
  const shortcut = getGlobalShortcut();
  try {
    const ok = globalShortcut.register(shortcut, () => {
      toggleMiniWindow();
    });
    if (ok) {
      console.log(`[shortcut] Registered global shortcut: ${shortcut}`);
    } else {
      console.warn(`[shortcut] Failed to register global shortcut: ${shortcut} (may be taken by another app)`);
    }
  } catch (err) {
    console.error('[shortcut] Error registering global shortcut:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      // Security: strict process separation
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Needed for preload to work without issues in dev
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Force dark mode
  nativeTheme.themeSource = 'dark';

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${devClientPort}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // On macOS: hide to tray when window is closed (instead of quitting)
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          click: () => mainWindow?.webContents.send('app:openSettings'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/ganeshmshetty/RemCtrl');
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── Single Instance Lock ──────────────────────────────────────────────────────
// In development: allow multiple instances for host/controller testing.
//   - The 2nd instance shifts its userData dir so Chromium doesn't lock-crash.
//   - It also loads Vite on port 5174 instead of 5173.
// In production: enforce strict single-instance.
if (isDev) {
  const isPrimary = app.requestSingleInstanceLock();
  if (!isPrimary) {
    // We are the second dev instance (controller window).
    // Shift userData so Chromium doesn't crash on its DB locks.
    app.setPath('userData', app.getPath('userData') + '-dev-client');
    devClientPort = 5174;
  }
} else {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      // Focus existing window if a second production instance tries to launch
      showWindow();
    });
  }
}


app.whenReady().then(async () => {
  createMenu();
  const win = createWindow();
  setMainWindow(win);

  // Set up tray icon
  createTray();

  // Register global keyboard shortcut (Cmd+Shift+Space by default)
  registerGlobalShortcut();

  // Start WebSocket bridge server for Phase E Chrome Extension
  startExtensionBridgeServer(45456);

  // Pre-warm browser in background if profile is already initialized (skips first-launch onboarding)
  if (!isDev && isProfileInitialized() && !isBrowserRunning()) {
    launchBrowser('about:blank').catch((err) => {
      console.warn('[preload] Browser pre-warm failed (non-fatal):', err);
    });
  }

  app.on('activate', () => {
    // macOS: re-show window when dock icon is clicked
    showWindow();
  });

  ipcMain.handle('app:showMainWindow', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
    showWindow();
  });

  ipcMain.handle('app:hideMiniWindow', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  });

  ipcMain.handle('app:showMiniWindow', (_e, hideMain?: boolean) => {
    if (hideMain && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    const win = getOrCreateMiniWindow();
    win.show();
    win.focus();
    win.webContents.send('app:globalShortcut');
  });

  // ── Auto Updater configuration (Commented out until Code Signing is setup) ──
  /*
  autoUpdater.autoDownload = false; // Prompt user before downloading
  autoUpdater.allowPrerelease = true; // Allow downloading pre-releases

  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} of RemoteCtrl is available.`,
      detail: 'Would you like to download it now?',
      buttons: ['Download', 'Skip'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'The update has been successfully downloaded.',
      detail: 'Would you like to restart the application to apply the updates now?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater Error:', err);
  });

  // Check for updates (only in production)
  if (!isDev) {
    autoUpdater.checkForUpdates();
  }
  */
});

app.on('window-all-closed', () => {
  // On macOS: keep app alive in tray even with no windows open
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // On macOS: do nothing — tray keeps us alive
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Cancel any running agent/workflow and close the Playwright browser before quitting.
app.on('before-quit', async () => {
  isQuitting = true;
  stopExtensionBridgeServer();
  globalShortcut.unregisterAll();
  automationOrchestrator.cancelActiveTask();
  await automationOrchestrator.closePool().catch(() => { });
  await closeBrowser().catch(() => { });
});

// Security: block navigation away from the app
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const appUrl = isDev ? `http://localhost:${devClientPort}` : 'app://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
    }
  });
});
