/**
 * @file browser-pool.ts
 * @description Connection management utility for Playwright chromium instances connected via Chrome DevTools Protocol (CDP).
 * Key Exported APIs: `getBrowserPage` to fetch/reuse the current browser context page, and `closeBrowser` to terminate the active session.
 * Internal Mechanics: Connects asynchronously over CDP using `chromium.connectOverCDP`, manages a single active CDP URL connection, handles connection in-flight queuing to prevent race conditions, and extracts the last active page or instantiates new contexts.
 * Relations: Direct dependency on `sessionHistory` to reset logs when connections close, and is called by the main execution loop to obtain Playwright hooks.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { BrowserConnectionError } from '../errors.js';
import type { AgentLogPayload } from '../../shared/types.js';
import { sessionHistory } from './agent-history.js';

let activeBrowser: Browser | null = null;
let activeCdpUrl: string | null = null;
let pendingConnection: Promise<Browser> | null = null;

export async function getBrowserPage(
  cdpUrl: string,
  onLog?: (level: AgentLogPayload['level'], msg: string) => void,
): Promise<Page> {
  if (pendingConnection && activeCdpUrl === cdpUrl) {
    onLog?.('info', '[BrowserPool] Awaiting in-flight CDP connection...');
    await pendingConnection.catch(() => {});
  }

  if (activeBrowser && activeCdpUrl === cdpUrl) {
    const contexts = activeBrowser.contexts();
    const context = contexts[0];
    if (context) {
      const pages = context.pages();
      const activePage = pages.at(-1);
      if (activePage && !activePage.isClosed()) {
        onLog?.('info', '[BrowserPool] Reusing active Playwright page.');
        return activePage;
      }
    }
  }

  // Need to connect fresh
  await closeBrowser();

  activeCdpUrl = cdpUrl;
  onLog?.('info', `[BrowserPool] Connecting to local browser via CDP: ${cdpUrl}`);

  pendingConnection = (async () => {
    try {
      const browser = await chromium.connectOverCDP(cdpUrl, {
        timeout: 15_000,
      });
      activeBrowser = browser;
      return browser;
    } catch (err: any) {
      activeBrowser = null;
      activeCdpUrl = null;
      throw new BrowserConnectionError(
        `Failed to connect to browser CDP at ${cdpUrl}: ${err?.message ?? String(err)}`,
      );
    } finally {
      pendingConnection = null;
    }
  })();

  const browser = await pendingConnection;
  const contexts = browser.contexts();
  const context = contexts[0] ?? (await browser.newContext());
  const pages = context.pages();
  const page = pages.at(-1) ?? (await context.newPage());

  onLog?.('info', '[BrowserPool] Connected to active page.');
  return page;
}

export async function closeBrowser(): Promise<void> {
  sessionHistory.clear();
  if (activeBrowser) {
    try {
      await activeBrowser.close();
    } catch {
      // ignore errors on close
    }
    activeBrowser = null;
    activeCdpUrl = null;
  }
}
