/**
 * Browser Pool — Singleton Playwright CDP connection management for Automation Orchestrator
 *
 * Replaces Stagehand with direct, lightweight Playwright connection pooling.
 * Connects to the local Chrome instance via CDP without cold-start delay or extra LLM dependencies.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { BrowserConnectionError } from '../errors.js';
import type { AgentLogPayload } from '../../shared/types.js';

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
