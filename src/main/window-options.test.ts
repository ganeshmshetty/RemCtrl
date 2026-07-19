import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getName: () => 'RemoteCtrl',
    getPath: () => '/tmp/remotectrl',
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
  },
  BrowserWindow: class {},
  globalShortcut: {},
  ipcMain: {},
  Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
  nativeImage: {},
  nativeTheme: {},
  session: { defaultSession: {} },
  shell: {},
  Tray: class {},
}));

vi.mock('./ipc-handlers.js', () => ({ setMainWindow: vi.fn() }));
vi.mock('./browser-manager.js', () => ({ closeBrowser: vi.fn(), launchBrowser: vi.fn(), isBrowserRunning: vi.fn() }));
vi.mock('./automation/index.js', () => ({ automationOrchestrator: {} }));
vi.mock('./storage.js', () => ({ getGlobalShortcut: vi.fn(), isProfileInitialized: vi.fn(), getKeepBrowserOpenOnQuit: vi.fn() }));
vi.mock('./ext-server.js', () => ({ startExtensionBridgeServer: vi.fn(), stopExtensionBridgeServer: vi.fn() }));
vi.mock('./webrtc-manager.js', () => ({ webRTCManager: {} }));

import { createMenu, getMainWindowOptions } from './index.js';

describe('main window platform configuration', () => {
  it('uses hidden titlebar overlay controls and no native menu on Windows/Linux', () => {
    const windows = getMainWindowOptions('win32');
    const linux = getMainWindowOptions('linux');

    expect(windows.titleBarStyle).toBe('hidden');
    expect(windows.titleBarOverlay).toEqual(expect.objectContaining({ height: 46 }));
    expect(linux.titleBarStyle).toBe('hidden');
    expect(linux.titleBarOverlay).toEqual(expect.objectContaining({ height: 46 }));
    expect(createMenu('win32')).toBe(false);
    expect(createMenu('linux')).toBe(false);
  });

  it('keeps the native macOS titlebar and application menu', () => {
    const mac = getMainWindowOptions('darwin');

    expect(mac.titleBarStyle).toBe('hiddenInset');
    expect(mac.titleBarOverlay).toBeUndefined();
    expect(createMenu('darwin')).toBe(true);
  });
});
