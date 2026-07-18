/**
 * Browser discovery and launch-support helpers.
 *
 * This module owns environment-specific discovery (Chrome binaries, CDP
 * endpoints, and available ports). The browser manager can therefore focus on
 * lifecycle and tab orchestration, while CLI or test callers can reuse the
 * discovery seam without importing the full browser controller.
 */
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { createDevelopmentLogger } from './dev-logger.js';

const terminalLog = createDevelopmentLogger('Dev');

export async function getAvailablePort(defaultPort: number): Promise<number> {
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

export async function resolveCdpWsUrl(httpBase: string, maxWaitMs = 8000): Promise<string> {
  const versionUrl = `${httpBase}/json/version`;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(versionUrl);
      if (resp.ok) {
        const data = await resp.json() as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) {
          terminalLog.info(`[browser] CDP WS endpoint resolved: ${data.webSocketDebuggerUrl}`);
          return data.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      lastErr = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`CDP endpoint ${versionUrl} not ready after ${maxWaitMs}ms. Last error: ${lastErr}`);
}

export function findSystemChrome(): string | null {
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
    try {
      const which = execFileSync('which', ['google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge'], { encoding: 'utf-8' });
      const found = which.split('\n').find((candidate) => candidate.trim().length > 0);
      if (found) return found.trim();
    } catch { /* no system browser found through which */ }
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      terminalLog.info(`[browser] Found system Chrome at: ${candidate}`);
      return candidate;
    }
  }
  return null;
}

export function isEmptyProfile(profileDir: string): boolean {
  if (!fs.existsSync(profileDir)) return true;
  return !fs.existsSync(path.join(profileDir, 'Default', 'Preferences'));
}

async function isPortOpen(port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

function getChromeUserDataDirs(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    candidates.push(path.join(base, 'Google/Chrome'), path.join(base, 'Google/Chrome Canary'), path.join(base, 'Chromium'), path.join(base, 'BraveSoftware/Brave-Browser'));
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(path.join(localAppData, 'Google/Chrome/User Data'), path.join(localAppData, 'Google/Chrome SxS/User Data'), path.join(localAppData, 'Chromium/User Data'), path.join(localAppData, 'BraveSoftware/Brave-Browser/User Data'));
  } else {
    const base = path.join(home, '.config');
    candidates.push(path.join(base, 'google-chrome'), path.join(base, 'google-chrome-unstable'), path.join(base, 'chromium'), path.join(base, 'BraveSoftware/Brave-Browser'));
  }
  return candidates.filter((directory) => fs.existsSync(directory));
}

export async function discoverChromeCdpUrl(): Promise<string> {
  for (const dataDir of getChromeUserDataDirs()) {
    const portFilePath = path.join(dataDir, 'DevToolsActivePort');
    if (!fs.existsSync(portFilePath)) continue;
    try {
      const lines = fs.readFileSync(portFilePath, 'utf-8').trim().split('\n');
      const port = parseInt(lines[0]?.trim() ?? '', 10);
      const wsPath = lines[1]?.trim() || '/devtools/browser';
      if (await isPortOpen(port)) {
        terminalLog.info(`[browser] Discovered active Chrome debugging port ${port} from ${portFilePath}`);
        return `ws://127.0.0.1:${port}${wsPath}`;
      }
    } catch {
      // A profile may disappear while Chrome is shutting down; keep searching.
    }
  }
  if (await isPortOpen(9222)) {
    try { return await resolveCdpWsUrl('http://127.0.0.1:9222', 2000); }
    catch { return 'ws://127.0.0.1:9222/devtools/browser'; }
  }
  const executablePath = findSystemChrome();
  if (executablePath) {
    try { spawn(executablePath, ['chrome://inspect/#remote-debugging'], { detached: true, stdio: 'ignore' }).unref(); }
    catch { /* opening the settings page is best effort */ }
  }
  throw new Error(
    'Could not discover a running Chrome instance with remote debugging enabled.\n\n' +
    'We have opened "chrome://inspect/#remote-debugging" in your Chrome browser.\n' +
    'Please tick the checkbox "Allow remote debugging for this browser instance" to enable it, and then try connecting again.',
  );
}
