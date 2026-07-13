/**
 * @file webrtc.ipc.ts
 * @description Main process Electron IPC registration module managing WebRTC signaling connection exchanges and controller lifecycle.
 * Key Exported APIs: `registerWebRtcIpc` to attach host/controller signaling events.
 * Internal Mechanics: Interacts directly with the singleton `webRTCManager` to initialize/destroy peer clients, configure signaling parameters, and manage connection states (e.g., host approval/rejection or controller pins).
 * Relations: Connects renderer-initiated UI actions (such as starting a host or connecting a controller) to the WebSocket signaling server and triggers Playwright window shutdown via `closeBrowser` on host stop.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { ApproveControllerSchema, ConnectPinSchema } from '../../shared/schemas.js';
import { getSignalingUrl } from '../storage.js';
import { webRTCManager } from '../webrtc-manager.js';
import { closeBrowser } from '../browser-manager.js';

export function registerWebRtcIpc(win: BrowserWindow) {
  ipcMain.handle('host:start', async () => {
    webRTCManager.destroyClient();
    const client = webRTCManager.getOrCreateClient();
    const url = getSignalingUrl();
    try {
      await client.startHost(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!win.isDestroyed()) win.webContents.send('app:error', msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  });

  ipcMain.handle('host:stop', async () => {
    webRTCManager.destroyClient();
    await closeBrowser();
  });

  ipcMain.handle('host:approveController', async (_e, controllerId: unknown) => {
    const { controllerId: id } = ApproveControllerSchema.parse({ controllerId });
    webRTCManager.getClient()?.approveController(id);
  });

  ipcMain.handle('host:rejectController', async (_e, controllerId: unknown) => {
    const { controllerId: id } = ApproveControllerSchema.parse({ controllerId });
    webRTCManager.getClient()?.rejectController(id);
  });

  ipcMain.handle('controller:connect', async (_e, pin: string) => {
    const parsed = ConnectPinSchema.parse({ pin });
    webRTCManager.destroyClient();
    const client = webRTCManager.getOrCreateClient();
    const url = getSignalingUrl();
    try {
      await client.connectAsController(url, parsed.pin);
    } catch (err) {
      // Error already sent to renderer by pushError
    }
    return { ok: true };
  });

  ipcMain.handle('controller:disconnect', async () => {
    webRTCManager.destroyClient();
  });

  ipcMain.handle('webrtc:sendSignal', async (_e, signal: unknown) => {
    const t = (signal as any)?.type ?? '?';
    const client = webRTCManager.getClient();
    const role = client?.getRole();
    console.log(`[ipc] webrtc:sendSignal role=${role ?? '(no client)'}, type=${t}`);
    if (client && (role === 'host' || role === 'controller')) {
      client.sendSignal(role, signal);
    }
  });
}
