import { beforeEach, describe, expect, it, vi } from 'vitest';

const menuMocks = vi.hoisted(() => {
  const nativeMenu = { platform: 'darwin' };
  return {
    nativeMenu,
    buildFromTemplate: vi.fn(() => nativeMenu),
    setApplicationMenu: vi.fn(),
  };
});

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
  Menu: menuMocks,
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

beforeEach(() => {
  menuMocks.buildFromTemplate.mockClear();
  menuMocks.setApplicationMenu.mockClear();
});

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
    expect(menuMocks.buildFromTemplate).not.toHaveBeenCalled();
    expect(menuMocks.setApplicationMenu).toHaveBeenNthCalledWith(1, null);
    expect(menuMocks.setApplicationMenu).toHaveBeenNthCalledWith(2, null);
  });

  it('keeps the native macOS titlebar and application menu', () => {
    const mac = getMainWindowOptions('darwin');

    expect(mac.titleBarStyle).toBe('hiddenInset');
    expect(mac.titleBarOverlay).toBeUndefined();
    expect(createMenu('darwin')).toBe(true);
    expect(menuMocks.buildFromTemplate).toHaveBeenCalledOnce();
    expect(menuMocks.buildFromTemplate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'RemoteCtrl' }),
        expect.objectContaining({ label: 'File' }),
      ]),
    );
    expect(menuMocks.setApplicationMenu).toHaveBeenCalledOnce();
    expect(menuMocks.setApplicationMenu).toHaveBeenCalledWith(menuMocks.nativeMenu);
  });
});
