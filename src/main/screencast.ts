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
