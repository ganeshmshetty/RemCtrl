/**
 * @file browser-manager.ts
 * @description Core browser automation controller. Orchestrates Playwright browser contexts, handles tab registration, captures page states, and performs remote mouse/keyboard input injection.
 * @module main/browser-manager
 * 
 * Key Exports:
 * - Lifecycle: `launchBrowser()`, `closeBrowser()`, `isBrowserRunning()`, and `resetProfile()`.
 * - Tab Navigation: `switchTab()`, `newTab()`, `closeTab()`, `navigate()`, `goBack()`, `goForward()`, and `reload()`.
 * - Event & Input: `injectMouse()`, `injectKeyboard()`, `getCaptureMetadata()`, `setBrowserNotifyWindow()`, and `getCdpUrl()`.
 * 
 * Mechanics & Relations:
 * - Resolves the local or internal Chromium executable pathway, binds to CDP (Chrome DevTools Protocol) ports, and registers page listeners (`load`, `close`, `framenavigated`).
 * - Invokes `startScreencast` and `stopScreencast` (`screencast.ts`) to capture frame updates and transmits them to Electron's renderer via WebContents IPC (`browser:tabsChange`).
 * - Connects Stagehand or custom agents using the retrieved CDP WebSocket URL (`getCdpUrl()`) and coordinates with `storage.ts` for browser profile retrieval.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { RemoteMousePayload, RemoteKeyboardPayload, CaptureMetadata, TabInfo } from '../shared/types.js';
import { startScreencast, stopScreencast } from './screencast.js';
import { getBrowserMode, getHeadlessMode, getBrowserProfileDir, isProfileInitialized, markProfileInitialized, getKeepBrowserOpenOnQuit } from './storage.js';
import { discoverChromeCdpUrl, findSystemChrome, getAvailablePort, isEmptyProfile, resolveCdpWsUrl } from './browser-discovery.js';
import { closeBrowser as closeAutomationPool } from './automation/browser-pool.js';
import { moveCursorTo, triggerRipple } from './automation/cursor-overlay.js';
import { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import { createDevelopmentLogger } from './dev-logger.js';
import { buildManagedChromeLaunchArgs, buildManagedPersistentContextOptions } from './browser-launch-options.js';

export const BROWSER_TITLE = 'RemoteCtrl Host Browser';
const NEW_TAB_URL = 'https://duckduckgo.com/';

interface PageEntry {
  id: string;
  page: Page;
  title: string;
}

// CDP port used in internal mode so Stagehand can connect via raw CDP.
// A port distinct from local Chrome (9222) to avoid conflicts.
const INTERNAL_CDP_PORT = 9223;
const terminalLog = createDevelopmentLogger('Dev');

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let pages: PageEntry[] = [];
let activePageEntry: PageEntry | null = null;
let notifyWindow: BrowserWindow | null = null;
let isClosingBrowser = false;
// Page creation emits the context `page` event before newPage() resolves. Keep
// track of app-initiated tabs so that event does not foreground Chrome.
let suppressNewTabFocus = 0;
/** Resolved ws:// debugger URL passed to Stagehand — populated on launch. */
let cdpWsUrl: string | null = null;

export function setBrowserNotifyWindow(win: BrowserWindow) {
  notifyWindow = win;
}

let activeSourceWindow: BrowserWindow | null = null;
export function setActiveSourceWindow(win: BrowserWindow | null) {
  activeSourceWindow = win;
}

let tabsChangeTimeout: NodeJS.Timeout | null = null;
function emitTabsChange() {
  if (tabsChangeTimeout) clearTimeout(tabsChangeTimeout);
  tabsChangeTimeout = setTimeout(() => {
    if (notifyWindow && !notifyWindow.isDestroyed()) {
      notifyWindow.webContents.send('browser:tabsChange', getTabs());
    }
  }, 100);
}

function restoreAppFocus() {
  const target = activeSourceWindow && !activeSourceWindow.isDestroyed() && activeSourceWindow.isVisible()
    ? activeSourceWindow
    : notifyWindow && !notifyWindow.isDestroyed() && notifyWindow.isVisible()
      ? notifyWindow
      : null;

  if (target) {
    target.focus();
    setTimeout(() => {
      if (!target.isDestroyed() && target.isVisible()) {
        target.focus();
      }
    }, 100);
  }
}

async function forceTabActivation(page: Page, foregroundChrome = true) {
  // Existing-tab switches need to make Chrome's selected page active so its
  // screencast keeps rendering. Newly created tabs skip this to avoid Chrome
  // taking the operating-system focus away from RemoteCtrl.
  if (foregroundChrome) {
    await page.bringToFront().catch(() => {});
  }
  restoreAppFocus();
}

export function getTabs(): TabInfo[] {
  return pages.map(entry => {
    const url = entry.page.url();
    const isBlank = url === 'about:blank';
    return {
      id: entry.id,
      url,
      title: isBlank ? 'New Tab' : (entry.title || 'Loading...'),
      active: entry === activePageEntry,
    };
  });
}

export async function switchTab(tabId: string): Promise<void> {
  const targetEntry = pages.find(p => p.id === tabId);
  if (targetEntry && targetEntry !== activePageEntry) {
    activePageEntry = targetEntry;
    await forceTabActivation(activePageEntry.page);
    await startScreencast(activePageEntry.page);
    emitTabsChange();
  }
}

export async function goBack(): Promise<void> {
  if (activePageEntry) await activePageEntry.page.goBack().catch(() => {});
}

export async function goForward(): Promise<void> {
  if (activePageEntry) await activePageEntry.page.goForward().catch(() => {});
}

export async function reload(): Promise<void> {
  if (activePageEntry) await activePageEntry.page.reload().catch(() => {});
}

export async function navigate(url: string): Promise<void> {
  if (activePageEntry) {
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = 'https://' + url;
    }
    await activePageEntry.page.goto(targetUrl).catch(() => {});
  }
}

export async function closeTab(tabId: string): Promise<void> {
  const targetEntry = pages.find(p => p.id === tabId);
  if (targetEntry) {
    await targetEntry.page.close().catch(() => {});
  }
}

export async function newTab(): Promise<void> {
  const currentContext = context;
  if (!currentContext || isClosingBrowser) return;

  suppressNewTabFocus += 1;
  try {
    // Playwright owns the context, so creating the page directly is reliable in
    // persistent and CDP-connected modes. The former CDP background-target path
    // could time out waiting for a page event that Chrome never emitted.
    const page = await currentContext.newPage();
    if (isClosingBrowser || context !== currentContext || page.isClosed()) {
      await page.close().catch(() => {});
      return;
    }
    await page.goto(NEW_TAB_URL, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
    // The context page listener deliberately avoids foregrounding an
    // app-created tab. Finalize its selected state here so the renderer gets
    // an immediate, reliable tab update and the new page is screencast.
    const entry = pages.find((candidate) => candidate.page === page);
    if (entry) {
      activePageEntry = entry;
      await startScreencast(page);
      emitTabsChange();
    }
    restoreAppFocus();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isClosingBrowser && !msg.includes('Browser has been closed') && !msg.includes('Target page, context or browser has been closed')) {
      terminalLog.error('[browser] failed to open new tab:', err);
    }
  } finally {
    suppressNewTabFocus = Math.max(0, suppressNewTabFocus - 1);
  }
}

function registerPage(p: Page) {
  const entry: PageEntry = { id: crypto.randomUUID(), page: p, title: 'Loading...' };
  pages.push(entry);

  p.on('close', () => {
    void handlePageClosed(entry).catch((err) => {
      if (!isClosingBrowser) terminalLog.warn('[browser] page-close cleanup failed:', err);
    });
  });

  async function handlePageClosed(closedEntry: PageEntry) {
    pages = pages.filter(x => x !== closedEntry);
    if (activePageEntry === closedEntry) {
      const nextEntry = pages[pages.length - 1] || null;
      activePageEntry = nextEntry;
      if (nextEntry && !isClosingBrowser && !nextEntry.page.isClosed()) {
        await forceTabActivation(nextEntry.page);
        if (activePageEntry === nextEntry && !nextEntry.page.isClosed()) {
          await startScreencast(nextEntry.page);
        }
      } else {
        await stopScreencast();
        // If last tab is closed, automatically open a new one
        if (context && !isClosingBrowser) {
          void newTab();
        }
      }
    }
    emitTabsChange();
  }

  p.on('load', async () => {
    try { entry.title = await p.title(); } catch { }
    emitTabsChange();
  });

  p.on('framenavigated', (frame) => {
    if (frame === p.mainFrame()) {
      emitTabsChange();
    }
  });
  
  p.title().then(t => { entry.title = t; emitTabsChange(); }).catch(() => {});

  return entry;
}

export async function launchBrowser(startUrl = 'https://www.google.com', headlessOverride?: boolean): Promise<string> {
  if (browser) {
    terminalLog.info('[browser] Playwright already running, reusing');
    return BROWSER_TITLE;
  }

  isClosingBrowser = false;

  const mode = getBrowserMode();

  if (mode === 'local_chrome') {
    try {
      terminalLog.info('[browser] Auto-discovering running debug Chrome...');
      cdpWsUrl = await discoverChromeCdpUrl();
      terminalLog.info(`[browser] Connecting to discovered CDP endpoint: ${cdpWsUrl}`);

      browser = await chromium.connectOverCDP(cdpWsUrl);
      // Use existing default context
      context = browser.contexts()[0];
      if (!context) {
         context = await browser.newContext();
      }
    } catch (err: any) {
      terminalLog.error('[browser] Failed to connect to local Chrome:', err.message);
      throw new Error(err.message);
    }
  } else {
    // ── Internal mode: persistent profile ───────────────────────────────────
    const headless = headlessOverride ?? getHeadlessMode();
    const profileDir = getBrowserProfileDir();

    // Detect first-launch for onboarding (before creating profile dir)
    const firstLaunch = isEmptyProfile(profileDir) && !isProfileInitialized();
    const launchHeadless = headlessOverride === true ? true : firstLaunch ? false : headless;

    const keepOpen = getKeepBrowserOpenOnQuit();
    const cdpPort = INTERNAL_CDP_PORT;

    let alreadyRunning = false;
    try {
      const checkResp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (checkResp.ok) {
        alreadyRunning = true;
      }
    } catch {
      // not running
    }

    if (alreadyRunning) {
      if (keepOpen) {
        terminalLog.info(`[browser] Detached Chrome already running on port ${cdpPort}, connecting...`);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        context = browser.contexts()[0];
        if (!context) {
          context = await browser.newContext();
        }
        cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${cdpPort}`);
      } else {
        terminalLog.info(`[browser] Leftover Chrome detected on port ${cdpPort}. Closing it before launching a new context...`);
        try {
          const tempBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
          await tempBrowser.close();
          // Give it a moment to release file locks
          await new Promise(r => setTimeout(r, 1200));
        } catch (err) {
          terminalLog.warn('[browser] Failed to close leftover Chrome cleanly:', err);
        }
      }
    }

    if (!browser) {
      if (keepOpen) {
        const systemChrome = findSystemChrome();
        const executablePath = systemChrome || undefined;
        if (!executablePath) {
          throw new Error('Chrome browser not found on this system. Please install Google Chrome or Edge.');
        }
        terminalLog.info(`[browser] Spawning detached Chrome process: ${executablePath}`);
        const args = buildManagedChromeLaunchArgs({
          remoteDebuggingPort: cdpPort,
          userDataDir: profileDir,
          headless: launchHeadless,
        });
        const child = spawn(executablePath, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${cdpPort}`);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        context = browser.contexts()[0];
        if (!context) {
          context = await browser.newContext();
        }
      } else {
      // Try system Chrome first, fall back to bundled Playwright Chromium
      const systemChrome = findSystemChrome();
      const executablePath = systemChrome || undefined;
      if (systemChrome) {
        terminalLog.info(`[browser] Using system Chrome: ${systemChrome}`);
      } else {
        terminalLog.info('[browser] No system Chrome found, using bundled Playwright Chromium');
      }

      terminalLog.info(`[browser] Launching persistent context (headless: ${headless}) → ${profileDir}`);

      const dynamicPort = await getAvailablePort(INTERNAL_CDP_PORT);

      context = await chromium.launchPersistentContext(profileDir, buildManagedPersistentContextOptions({
        remoteDebuggingPort: dynamicPort,
        userDataDir: profileDir,
        headless: launchHeadless,
        executablePath,
      }));

      browser = context.browser() ?? (context as unknown as Browser);
      cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${dynamicPort}`);
    }
    }

    if (firstLaunch) {
      terminalLog.info('[browser] First launch — onboarding mode (visible browser for login)');
      markProfileInitialized();
      if (notifyWindow && !notifyWindow.isDestroyed()) {
        notifyWindow.webContents.send('browser:firstLaunch');
      }
    }
  }

  if (!context) {
    throw new Error('Browser context failed to initialize');
  }

  // Flag: true while launchBrowser is setting up the first page so that the
  // context.on('page') handler skips the fire-and-forget startScreencast call
  // for that initial page (it's explicitly awaited right after context.newPage()).
  let launchingInitialPage = false;

  context.on('page', (p: Page) => {
    const entry = registerPage(p);
    activePageEntry = entry;
    const isAppInitiatedNewTab = suppressNewTabFocus > 0;
    // Skip auto-start for the very first page — launchBrowser() awaits it
    // explicitly below to avoid a double-start race.
    if (!launchingInitialPage && !isClosingBrowser && !p.isClosed()) {
      void (async () => {
        await forceTabActivation(p, !isAppInitiatedNewTab);
        if (!isClosingBrowser && !p.isClosed()) {
          await startScreencast(p);
          emitTabsChange();
        }
      })().catch(() => {});
    }
  });

  context.on('close', () => {
    isClosingBrowser = true;
    terminalLog.warn('[browser] Chrome context closed unexpectedly or by user');
    browser = null;
    context = null;
    cdpWsUrl = null;
    pages = [];
    activePageEntry = null;
    stopScreencast().catch(() => {});
    emitTabsChange();
  });

  // Populate existing pages if connecting to a live browser
  for (const p of context.pages()) {
    registerPage(p);
  }

  if (pages.length === 0) {
    launchingInitialPage = true;
    await context.newPage();
    launchingInitialPage = false;
    // Explicitly await screencast start so CDP is ready before navigation.
    if (activePageEntry) {
      await startScreencast(activePageEntry.page);
      emitTabsChange();
    }
  } else {
    activePageEntry = pages[0];
    await forceTabActivation(activePageEntry.page);
    await startScreencast(activePageEntry.page);
    emitTabsChange();
  }

  if (activePageEntry) {
    await activePageEntry.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => { });
  }

  terminalLog.info(`[browser] Playwright connected in ${mode} mode`);
  return BROWSER_TITLE;
}

export async function closeBrowser(): Promise<void> {
  isClosingBrowser = true;
  await stopScreencast();
  try {
    await closeAutomationPool().catch(() => {});
    await context?.close();
    // Only close the browser separately if we have a real Browser reference
    // (in persistent context mode, closing context is sufficient)
    if (browser && browser !== (context as unknown as Browser)) {
      await browser.close();
    }
  } catch {
    // ignore close errors
  }
  browser = null;
  context = null;
  cdpWsUrl = null;
  pages = [];
  activePageEntry = null;
  terminalLog.info('[browser] Playwright browser closed');
}

export function getPage(): Page | null { return activePageEntry?.page || null; }
export function isBrowserRunning(): boolean { return browser !== null; }

/**
 * Returns the raw CDP WebSocket URL Stagehand needs to connect to the browser.
 * Populated after launchBrowser() resolves by polling /json/version.
 */
export function getCdpUrl(): string | null {
  return cdpWsUrl;
}

export async function resetProfile(): Promise<void> {
  // Clear all browser data in the persistent context
  if (context) {
    await context.clearCookies().catch(() => {});
    // Clear storage state on all pages
    for (const p of context.pages()) {
      await p.evaluate(() => {
        try { localStorage.clear(); } catch { }
        try { sessionStorage.clear(); } catch { }
      }).catch(() => {});
    }
  }
  // Keep profile marked as initialized after reset so re-onboarding isn't triggered
  markProfileInitialized();
}

export function getCaptureMetadata() {
  if (!activePageEntry) return null;
  const vp = activePageEntry.page.viewportSize();
  return {
    viewportWidth: vp?.width ?? 1280,
    viewportHeight: vp?.height ?? 800,
    captureWidth: vp?.width ?? 1280,
    captureHeight: vp?.height ?? 800,
    deviceScaleFactor: 1,
    contentRect: { x: 0, y: 0, width: vp?.width ?? 1280, height: vp?.height ?? 800 },
  };
}

export async function injectMouse(payload: RemoteMousePayload, meta: CaptureMetadata) {
  if (!activePageEntry) return;
  const x = payload.xPercent * meta.viewportWidth;
  const y = payload.yPercent * meta.viewportHeight;

  // Fire-and-forget: visually move the agent's custom cursor
  moveCursorTo(activePageEntry.page, x, y).catch(() => {});

  if (payload.action === 'move') {
    await activePageEntry.page.mouse.move(x, y);
  } else if (payload.action === 'down') {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.down({ button: payload.button || 'left' });
  } else if (payload.action === 'up') {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.up({ button: payload.button || 'left' });
  } else if (payload.action === 'click') {
    triggerRipple(activePageEntry.page, x, y).catch(() => {});
    await activePageEntry.page.mouse.click(x, y, { button: payload.button || 'left' });
  } else if (payload.action === 'scroll' && payload.deltaY) {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.wheel(0, payload.deltaY);
  }
}

export async function injectKeyboard(payload: RemoteKeyboardPayload) {
  if (!activePageEntry) return;
  if (payload.action === 'down') {
    await activePageEntry.page.keyboard.down(payload.key);
  } else if (payload.action === 'up') {
    await activePageEntry.page.keyboard.up(payload.key);
  } else if (payload.action === 'press') {
    await activePageEntry.page.keyboard.press(payload.key);
  }
}
