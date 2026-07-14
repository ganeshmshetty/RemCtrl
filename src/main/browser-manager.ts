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
import { getBrowserMode, getHeadlessMode, getUseVisionCUA, BROWSER_PROFILE_DIR, getBrowserProfileDir, isProfileInitialized, markProfileInitialized, getKeepBrowserOpenOnQuit } from './storage.js';
import { closeBrowser as closeAutomationPool } from './automation/browser-pool.js';
import { moveCursorTo, triggerRipple } from './automation/cursor-overlay.js';
import { BrowserWindow } from 'electron';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

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

async function forceTabActivation(page: Page) {
  // 1. Steal OS focus to un-throttle Chromium's rendering pipeline
  await page.bringToFront().catch(() => {});
  
  // 2. Instantly reclaim focus for our Electron app explicitly to the source that requested it
  if (activeSourceWindow && !activeSourceWindow.isDestroyed() && activeSourceWindow.isVisible()) {
    activeSourceWindow.focus();
    setTimeout(() => {
      if (activeSourceWindow && !activeSourceWindow.isDestroyed() && activeSourceWindow.isVisible()) {
        activeSourceWindow.focus();
      }
    }, 100);
  } else if (notifyWindow && !notifyWindow.isDestroyed() && notifyWindow.isVisible()) {
    notifyWindow.focus();
    setTimeout(() => {
      if (notifyWindow && !notifyWindow.isDestroyed() && notifyWindow.isVisible()) {
        notifyWindow.focus();
      }
    }, 100);
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
        const client = await context.newCDPSession(activePageEntry.page);
        await client.send('Target.createTarget', {
          url: 'about:blank',
          background: true,
        });
        await pagePromise;
        await client.detach().catch(() => {});
      } else {
        const page = await context.newPage();
        await page.goto('about:blank');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Target.createTarget') || msg.includes('Browser has been closed')) {
        // Expected race condition if browser is shutting down
        return;
      }
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

function getChromeUserDataDirs(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    candidates.push(
      path.join(base, 'Google/Chrome'),
      path.join(base, 'Google/Chrome Canary'),
      path.join(base, 'Chromium'),
      path.join(base, 'BraveSoftware/Brave-Browser')
    );
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(localAppData, 'Google/Chrome/User Data'),
      path.join(localAppData, 'Google/Chrome SxS/User Data'),
      path.join(localAppData, 'Chromium/User Data'),
      path.join(localAppData, 'BraveSoftware/Brave-Browser/User Data')
    );
  } else {
    // Linux
    const base = path.join(home, '.config');
    candidates.push(
      path.join(base, 'google-chrome'),
      path.join(base, 'google-chrome-unstable'),
      path.join(base, 'chromium'),
      path.join(base, 'BraveSoftware/Brave-Browser')
    );
  }

  return candidates.filter(dir => fs.existsSync(dir));
}

async function isPortOpen(port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

async function discoverChromeCdpUrl(): Promise<string> {
  const dataDirs = getChromeUserDataDirs();
  for (const dataDir of dataDirs) {
    const portFilePath = path.join(dataDir, 'DevToolsActivePort');
    if (!fs.existsSync(portFilePath)) continue;

    try {
      const content = fs.readFileSync(portFilePath, 'utf-8').trim();
      const lines = content.split('\n');
      if (lines.length === 0) continue;

      const port = parseInt(lines[0].trim(), 10);
      const wsPath = lines[1] ? lines[1].trim() : '/devtools/browser';

      if (await isPortOpen(port)) {
        console.log(`[browser] Discovered active Chrome debugging port ${port} from ${portFilePath}`);
        return `ws://127.0.0.1:${port}${wsPath}`;
      }
    } catch (e) {
      console.warn(`[browser] Failed to read/verify port file ${portFilePath}:`, e);
      continue;
    }
  }

  // Fallback to standard 9222 port check
  if (await isPortOpen(9222)) {
    try {
      const wsUrl = await resolveCdpWsUrl('http://127.0.0.1:9222', 2000);
      return wsUrl;
    } catch {
      return 'ws://127.0.0.1:9222/devtools/browser';
    }
  }

  // Attempt to open the remote debugging settings page in the running Chrome browser
  const executablePath = findSystemChrome();
  if (executablePath) {
    try {
      spawn(executablePath, ['chrome://inspect/#remote-debugging'], {
        detached: true,
        stdio: 'ignore'
      }).unref();
    } catch (e) {
      console.warn('[browser] Failed to open chrome://inspect settings page:', e);
    }
  }

  throw new Error(
    'Could not discover a running Chrome instance with remote debugging enabled.\n\n' +
    'We have opened "chrome://inspect/#remote-debugging" in your Chrome browser.\n' +
    'Please tick the checkbox "Allow remote debugging for this browser instance" to enable it, and then try connecting again.'
  );
}

export async function launchBrowser(startUrl = 'https://www.google.com'): Promise<string> {
  if (browser) {
    console.log('[browser] Playwright already running, reusing');
    return BROWSER_TITLE;
  }

  const mode = getBrowserMode();

  if (mode === 'local_chrome') {
    try {
      console.log('[browser] Auto-discovering running debug Chrome...');
      cdpWsUrl = await discoverChromeCdpUrl();
      console.log(`[browser] Connecting to discovered CDP endpoint: ${cdpWsUrl}`);

      browser = await chromium.connectOverCDP(cdpWsUrl);
      // Use existing default context
      context = browser.contexts()[0];
      if (!context) {
         context = await browser.newContext();
      }
    } catch (err: any) {
      console.error('[browser] Failed to connect to local Chrome:', err.message);
      throw new Error(err.message);
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
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--test-type',
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
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--test-type',
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
