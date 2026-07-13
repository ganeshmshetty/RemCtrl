import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { RemoteMousePayload, RemoteKeyboardPayload, CaptureMetadata, TabInfo } from '../shared/types.js';
import { startScreencast, stopScreencast } from './screencast.js';
import { getBrowserMode, getHeadlessMode, getUseVisionCUA, BROWSER_PROFILE_DIR, getBrowserProfileDir, isProfileInitialized, markProfileInitialized, getKeepBrowserOpenOnQuit } from './storage.js';
import { closeBrowser as closeAutomationPool } from './automation/browser-pool.js';
import type { BrowserWindow } from 'electron';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';

export const BROWSER_TITLE = 'RemoteCtrl Host Browser';

interface PageEntry {
  id: string;
  page: Page;
  title: string;
}

// CDP port used in internal mode so Stagehand can connect via raw CDP.
// A port distinct from local Chrome (9222) to avoid conflicts.
const INTERNAL_CDP_PORT = 9223;

async function getAvailablePort(defaultPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      const fallbackServer = net.createServer();
      fallbackServer.listen(0, '127.0.0.1', () => {
        const addr = fallbackServer.address();
        const freePort = typeof addr === 'object' && addr ? addr.port : 0;
        fallbackServer.close(() => resolve(freePort));
      });
    });
    server.listen(defaultPort, '127.0.0.1', () => {
      server.close(() => resolve(defaultPort));
    });
  });
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let pages: PageEntry[] = [];
let activePageEntry: PageEntry | null = null;
let notifyWindow: BrowserWindow | null = null;
/** Resolved ws:// debugger URL passed to Stagehand — populated on launch. */
let cdpWsUrl: string | null = null;

export function setBrowserNotifyWindow(win: BrowserWindow) {
  notifyWindow = win;
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

async function forceTabActivation(page: Page) {
  // 1. Steal OS focus to un-throttle Chromium's rendering pipeline
  await page.bringToFront().catch(() => {});
  // 2. Instantly reclaim focus for our Electron app
  if (notifyWindow && !notifyWindow.isDestroyed()) {
    notifyWindow.show();
    notifyWindow.focus();
  }
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
  if (context) {
    try {
      if (activePageEntry) {
        const pagePromise = context.waitForEvent('page');
        await activePageEntry.page.evaluate("window.open('about:blank', '_blank'); null;");
        await pagePromise;
      } else {
        const page = await context.newPage();
        await page.goto('about:blank');
      }
    } catch (err) {
      console.error('[browser] failed to open new tab:', err);
    }
  }
}

function registerPage(p: Page) {
  const entry: PageEntry = { id: crypto.randomUUID(), page: p, title: 'Loading...' };
  pages.push(entry);

  p.on('close', async () => {
    pages = pages.filter(x => x !== entry);
    if (activePageEntry === entry) {
      activePageEntry = pages[pages.length - 1] || null;
      if (activePageEntry) {
        await forceTabActivation(activePageEntry.page);
        await startScreencast(activePageEntry.page);
      } else {
        await stopScreencast();
        // If last tab is closed, automatically open a new one
        if (context) {
          newTab().catch(() => {});
        }
      }
    }
    emitTabsChange();
  });

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

/**
 * Polls the Chrome DevTools HTTP endpoint until the browser exposes its
 * WebSocket debugger URL, then returns that ws:// URL.
 * Chrome's root path returns 404; /json/version has what we need.
 */
async function resolveCdpWsUrl(httpBase: string, maxWaitMs = 8000): Promise<string> {
  const versionUrl = `${httpBase}/json/version`;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(versionUrl);
      if (resp.ok) {
        const data = await resp.json() as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) {
          console.log(`[browser] CDP WS endpoint resolved: ${data.webSocketDebuggerUrl}`);
          return data.webSocketDebuggerUrl;
        }
      }
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`CDP endpoint ${versionUrl} not ready after ${maxWaitMs}ms. Last error: ${lastErr}`);
}

/**
 * Attempt to find the user's installed Chrome/Chromium binary.
 * Returns a path string, or null if none found.
 */
function findSystemChrome(): string | null {
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else if (process.platform === 'win32') {
    const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    );
  } else {
    // Linux
    try {
      const which = execFileSync('which', ['google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge'], { encoding: 'utf-8' });
      const found = which.split('\n').find(p => p.trim().length > 0);
      if (found) return found.trim();
    } catch { /* no which */ }
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      console.log(`[browser] Found system Chrome at: ${c}`);
      return c;
    }
  }
  return null;
}

/**
 * Returns true if this is a brand-new, empty browser profile dir.
 * We detect by checking if the profile dir doesn't exist or has no Preferences file.
 */
function isEmptyProfile(profileDir = BROWSER_PROFILE_DIR): boolean {
  if (!fs.existsSync(profileDir)) return true;
  const prefsPath = `${profileDir}/Default/Preferences`;
  return !fs.existsSync(prefsPath);
}

export async function launchBrowser(startUrl = 'https://www.google.com'): Promise<string> {
  if (browser) {
    console.log('[browser] Playwright already running, reusing');
    return BROWSER_TITLE;
  }

  const mode = getBrowserMode();

  if (mode === 'local_chrome') {
    try {
      console.log('[browser] Attempting to connect to Local Chrome on port 9222...');
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
      // Use existing default context
      context = browser.contexts()[0];
      if (!context) {
         context = await browser.newContext();
      }
      // Resolve the actual ws:// debugger URL for Stagehand
      cdpWsUrl = await resolveCdpWsUrl('http://localhost:9222');
    } catch (err) {
      console.error('[browser] Failed to connect to local Chrome. Make sure it is running with --remote-debugging-port=9222', err);
      throw new Error('Failed to connect to local Chrome on port 9222.');
    }
  } else {
    // ── Internal mode: persistent profile ───────────────────────────────────
    const headless = getHeadlessMode();
    const useCua = getUseVisionCUA();
    const width = useCua ? 1288 : 1280;
    const height = useCua ? 711 : 800;
    const profileDir = getBrowserProfileDir();

    // Detect first-launch for onboarding (before creating profile dir)
    const firstLaunch = isEmptyProfile(profileDir) && !isProfileInitialized();
    const launchHeadless = firstLaunch ? false : headless;

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
        console.log(`[browser] Detached Chrome already running on port ${cdpPort}, connecting...`);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        context = browser.contexts()[0];
        if (!context) {
          context = await browser.newContext({ viewport: { width, height } });
        }
        cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${cdpPort}`);
      } else {
        console.log(`[browser] Leftover Chrome detected on port ${cdpPort}. Closing it before launching a new context...`);
        try {
          const tempBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
          await tempBrowser.close();
          // Give it a moment to release file locks
          await new Promise(r => setTimeout(r, 1200));
        } catch (err) {
          console.warn('[browser] Failed to close leftover Chrome cleanly:', err);
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
        console.log(`[browser] Spawning detached Chrome process: ${executablePath}`);
        const args = [
          `--remote-debugging-port=${cdpPort}`,
          `--user-data-dir=${profileDir}`,
          `--window-size=${width},${height}`,
          '--window-position=100,100',
          '--no-first-run',
          '--no-default-browser-check',
        ];
        if (launchHeadless) {
          args.push('--headless=new');
        }
        const child = spawn(executablePath, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${cdpPort}`);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        context = browser.contexts()[0];
        if (!context) {
          context = await browser.newContext({ viewport: { width, height } });
        }
      } else {
      // Try system Chrome first, fall back to bundled Playwright Chromium
      const systemChrome = findSystemChrome();
      const executablePath = systemChrome || undefined;
      if (systemChrome) {
        console.log(`[browser] Using system Chrome: ${systemChrome}`);
      } else {
        console.log('[browser] No system Chrome found, using bundled Playwright Chromium');
      }

      console.log(`[browser] Launching persistent context (headless: ${headless}) → ${profileDir}`);

      const dynamicPort = await getAvailablePort(INTERNAL_CDP_PORT);

      context = await chromium.launchPersistentContext(profileDir, {
        headless: launchHeadless,
        executablePath,
        args: [
          `--remote-debugging-port=${dynamicPort}`,
          `--window-size=${width},${height}`,
          '--window-position=100,100',
          '--no-first-run',
          '--no-default-browser-check',
        ],
        viewport: { width, height },
      });

      browser = context.browser() ?? (context as unknown as Browser);
      cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${dynamicPort}`);
    }
    }

    if (firstLaunch) {
      console.log('[browser] First launch — onboarding mode (visible browser for login)');
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
    // Skip auto-start for the very first page — launchBrowser() awaits it
    // explicitly below to avoid a double-start race.
    if (!launchingInitialPage) {
      forceTabActivation(p).then(() => startScreencast(p)).then(() => emitTabsChange()).catch(() => {});
    }
  });

  context.on('close', () => {
    console.log('[browser] Chrome context closed unexpectedly or by user');
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

  console.log(`[browser] Playwright connected in ${mode} mode`);
  return BROWSER_TITLE;
}

export async function closeBrowser(): Promise<void> {
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
  console.log('[browser] Playwright browser closed');
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

  if (payload.action === 'move') {
    await activePageEntry.page.mouse.move(x, y);
  } else if (payload.action === 'down') {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.down({ button: payload.button || 'left' });
  } else if (payload.action === 'up') {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.up({ button: payload.button || 'left' });
  } else if (payload.action === 'click') {
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
