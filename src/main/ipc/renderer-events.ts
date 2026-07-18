/**
 * Renderer event delivery seam.
 *
 * IPC modules should not each repeat Electron's window-lifecycle checks. This
 * module owns the projection from a main-process event to live renderer
 * windows, keeping delivery consistent and testable without starting Electron.
 */
import { BrowserWindow } from 'electron';

export interface RendererWindow {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

/** Deliver one event to every currently live renderer window. */
export function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  broadcastToWindows(BrowserWindow.getAllWindows(), channel, ...args);
}

/** Deliver one event to a specific renderer when it is still alive. */
export function sendToRenderer(
  window: RendererWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, ...args);
}

/** Internal adapter seam used by tests and by the Electron-backed helper. */
export function broadcastToWindows(
  windows: readonly RendererWindow[],
  channel: string,
  ...args: unknown[]
): void {
  for (const window of windows) sendToRenderer(window, channel, ...args);
}
