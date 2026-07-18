import type { Page } from 'playwright';
import { getPage, getCdpUrl, launchBrowser } from '../../browser-manager.js';
import { getBrowserPage } from '../browser-pool.js';
import { ensureCursorOverlay } from '../cursor-overlay.js';
import { BrowserNotReadyError } from '../../errors.js';
import type { AgentLogPayload } from '../../../shared/types.js';

/** A small browser-runtime seam for all future browser modes. */
export async function acquireReadyPage(options: {
  launchIfMissing: boolean;
  onLog?: (level: AgentLogPayload['level'], message: string) => void;
}): Promise<Page> {
  let page = getPage();
  // Browser-manager removes closed pages asynchronously from its active-page
  // registry. Do not leak a stale Playwright handle through this seam while
  // that cleanup is still in flight; reconnect through CDP below instead.
  if (page?.isClosed()) page = null;
  let cdpUrl = getCdpUrl();
  if ((!page || !cdpUrl) && options.launchIfMissing) {
    await launchBrowser();
    page = getPage();
    if (page?.isClosed()) page = null;
    cdpUrl = getCdpUrl();
  }
  if (!page && cdpUrl) {
    page = await getBrowserPage(cdpUrl, options.onLog);
  }
  if (!page) throw new BrowserNotReadyError('Launch a browser from the Host session first.');
  const readyPage = page;
  await ensureCursorOverlay(readyPage);
  return readyPage;
}
