/**
 * @file browser.ipc.ts
 * @description Electron main process IPC handlers managing Playwright browser lifecycle, window capture, and input redirection.
 * Key Exported APIs: `registerBrowserIpc` to attach IPC event handlers to the main electron runtime.
 * Internal Mechanics: Coordinates closely with the `browser-manager` module to perform action mapping (launching, tab switching, navigation, tab closure, and reloading).
 * Input Injection: Translates incoming mouse/keyboard coordinates and actions from remote control sessions using Zod schemas (`RemoteMousePayloadSchema`, `RemoteKeyboardPayloadSchema`) and injects them into the Playwright browser.
 * Relations: Direct integration with `browser-manager` and `desktopCapturer` to facilitate WebRTC frame sync and user-driven interaction loop.
 */

import { ipcMain, desktopCapturer } from 'electron';
import { RemoteMousePayloadSchema, RemoteKeyboardPayloadSchema } from '../../shared/schemas.js';
import { 
  launchBrowser, 
  closeBrowser, 
  getCaptureMetadata, 
  injectMouse, 
  injectKeyboard, 
  resetProfile,
  getTabs,
  switchTab,
  goBack,
  goForward,
  reload,
  navigate,
  closeTab,
  newTab
} from '../browser-manager.js';

export function registerBrowserIpc() {
  ipcMain.handle('browser:launch', async (_e, startUrl?: unknown) => {
    try {
      const title = await launchBrowser(
        typeof startUrl === 'string' ? startUrl : undefined,
      );
      return title;
    } catch (err) {
      console.error('[ipc] Failed to launch browser:', err);
      throw err;
    }
  });

  ipcMain.handle('browser:close', async () => {
    await closeBrowser();
  });

  ipcMain.handle('browser:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  ipcMain.handle('browser:injectMouse', async (_e, payload: unknown) => {
    const parsed = RemoteMousePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error('[ipc] Invalid mouse payload:', parsed.error);
      return;
    }
    const meta = getCaptureMetadata();
    if (meta) {
      await injectMouse(parsed.data, meta);
    }
  });

  ipcMain.handle('browser:injectKeyboard', async (_e, payload: unknown) => {
    const parsed = RemoteKeyboardPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error('[ipc] Invalid keyboard payload:', parsed.error);
      return;
    }
    await injectKeyboard(parsed.data);
  });

  ipcMain.handle('browser:resetProfile', async () => {
    await resetProfile();
    return { ok: true };
  });

  ipcMain.handle('browser:getTabs', async () => {
    return getTabs();
  });

  ipcMain.handle('browser:switchTab', async (_e, tabId: unknown) => {
    if (typeof tabId !== 'string' || !tabId) {
      return { ok: false, error: 'Invalid tabId: must be a non-empty string' };
    }
    await switchTab(tabId);
    return { ok: true };
  });

  ipcMain.handle('browser:goBack', async () => {
    await goBack();
    return { ok: true };
  });

  ipcMain.handle('browser:goForward', async () => {
    await goForward();
    return { ok: true };
  });

  ipcMain.handle('browser:reload', async () => {
    await reload();
    return { ok: true };
  });

  ipcMain.handle('browser:navigate', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !url) {
      return { ok: false, error: 'Invalid url: must be a non-empty string' };
    }
    await navigate(url);
    return { ok: true };
  });

  ipcMain.handle('browser:closeTab', async (_e, tabId: unknown) => {
    if (typeof tabId !== 'string' || !tabId) {
      return { ok: false, error: 'Invalid tabId: must be a non-empty string' };
    }
    await closeTab(tabId);
    return { ok: true };
  });

  ipcMain.handle('browser:newTab', async () => {
    await newTab();
    return { ok: true };
  });
}
