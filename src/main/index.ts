import {
  app,
  BrowserWindow,
  shell,
  nativeTheme,
} from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc-handlers.js';

// __dirname is available natively in CJS (esbuild target: cjs)

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

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
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  const win = createWindow();
  registerIpcHandlers(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      registerIpcHandlers(newWin);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: block navigation away from the app
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const appUrl = isDev ? 'http://localhost:5173' : 'app://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
    }
  });
});

// mainWindow exported for use in other modules if needed
