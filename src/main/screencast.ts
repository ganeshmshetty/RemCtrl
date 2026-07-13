/**
 * @file screencast.ts
 * @description CDP (Chrome DevTools Protocol) screencast client. Attaches to Playwright page contexts to stream real-time screen frames and propagates them to the frontend.
 * @module main/screencast
 * 
 * Key Exports:
 * - `setScreencastWindow(win)`: Associates the destination Electron `BrowserWindow` for screencast frame broadcasts.
 * - `startScreencast(page)`: Opens a new `CDPSession` on the targeted page, configures JPEG capture, listens to frame updates, and acknowledges receipts.
 * - `stopScreencast()`: Disables screencasting and detaches the current `CDPSession`.
 * 
 * Mechanics & Relations:
 * - Listens for `Page.screencastFrame` messages, decodes base64 payload strings to Node buffers, and dispatches them to the renderer via `screencast:frame` IPC.
 * - Managed directly by `browser-manager.ts` on page initialization and tab-switching actions.
 */

import type { CDPSession, Page } from 'playwright';
import type { BrowserWindow } from 'electron';

let activeSession: CDPSession | null = null;
let currentWindow: BrowserWindow | null = null;

export function setScreencastWindow(win: BrowserWindow) {
  currentWindow = win;
}

export async function startScreencast(page: Page) {
  await stopScreencast();
  
  let session: CDPSession | null = null;
  try {
    session = await page.context().newCDPSession(page);
    
    session.on('Page.screencastFrame', async ({ data, sessionId }) => {
      // data is base64 string
      if (currentWindow && !currentWindow.isDestroyed()) {
        const buffer = Buffer.from(data, 'base64');
        currentWindow.webContents.send('screencast:frame', buffer);
      }
      
      try {
        await session?.send('Page.screencastFrameAck', { sessionId });
      } catch (err) {
        // Ignored, session might be closed
      }
    });

    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      everyNthFrame: 1,
    });
    
    // Only assign after everything succeeds
    activeSession = session;
    console.log('[screencast] Started CDP screencast for page');
  } catch (err) {
    console.error('[screencast] Failed to start screencast', err);
    // Detach the local session if it was created, to avoid leaking it
    if (session) {
      try { await session.detach(); } catch { /* ignore */ }
    }
    activeSession = null;
  }
}

export async function stopScreencast() {
  if (activeSession) {
    try {
      await activeSession.send('Page.stopScreencast');
      await activeSession.detach();
    } catch (err) {
      // Ignored
    }
    activeSession = null;
  }
}
