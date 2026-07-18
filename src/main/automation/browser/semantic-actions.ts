import type { Page } from 'playwright';
import { ensureCursorOverlay, moveCursorToLocator } from '../cursor-overlay.js';
import { ElementTargetingEngine } from '../element-targeting-engine.js';
import { extractDOMAsMarkdown, extractNumberedDOMSnapshot } from '../dom-snapshot.js';
import type {
  BrowserActionGuard,
  BrowserActionExecutionOptions,
  BrowserActionResult,
  ElementActionKind,
  ElementTarget,
  SemanticBrowserAction,
} from './action-types.js';

export interface SemanticActionOptions {
  guard?: BrowserActionGuard;
  targetTimeoutMs?: number;
  waitForNetworkIdle?: boolean;
  /** Playwright navigation timeout; keeps workflow and agent modes explicit. */
  navigationTimeoutMs?: number;
  /** Bounded stabilization wait after navigation or an element action. */
  networkIdleTimeoutMs?: number;
}

/**
 * The single semantic browser-action module. It deliberately knows nothing
 * about AI SDK tools, workflow branching, Electron IPC, or a future CLI.
 */
export class SemanticActionEngine {
  constructor(private readonly page: Page, private readonly options: SemanticActionOptions = {}) {}

  async execute(action: SemanticBrowserAction, executionOptions: BrowserActionExecutionOptions = {}): Promise<BrowserActionResult> {
    switch (action.kind) {
      case 'navigate': return this.navigate(action.url, executionOptions);
      case 'element': return this.element(action, executionOptions);
      case 'observe': return this.observe(action.filter);
      case 'extract': return this.extract(action);
      case 'page-url': return this.pageUrl();
      case 'keys': return this.keys(action.key);
      case 'type': return this.type(action.text);
      case 'scroll': return this.scroll(action.direction, action.pixels);
      case 'wait': await sleep(action.ms); return { success: true };
    }
  }

  private async authorize(capability: Parameters<NonNullable<BrowserActionGuard>>[0]['capability'], summary: string, details?: Record<string, unknown>, url = this.page.url()) {
    return this.options.guard?.({ capability, summary, details, url });
  }

  private async navigate(url: string, executionOptions: BrowserActionExecutionOptions): Promise<BrowserActionResult> {
    const blocked = await this.authorize('browser.navigate', `Navigate to ${url}`, { url }, url);
    if (blocked) return blocked;
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: executionOptions.navigationTimeoutMs ?? this.options.navigationTimeoutMs,
    });
    await ensureCursorOverlay(this.page);
    await this.page.waitForLoadState('networkidle', {
      timeout: executionOptions.networkIdleTimeoutMs ?? this.options.networkIdleTimeoutMs,
    }).catch(() => {});
    return { success: true, url: this.page.url() };
  }

  private async element(action: Extract<SemanticBrowserAction, { kind: 'element' }>, executionOptions: BrowserActionExecutionOptions): Promise<BrowserActionResult> {
    const target = await this.resolveTarget(action.index, action.selector);
    const capability = action.action === 'fill' || action.action === 'select'
      ? 'browser.type'
      : action.action === 'press' ? 'browser.keypress' : 'browser.click';
    const blocked = await this.authorize(
      capability,
      action.description?.trim() || `${action.action} ${target.resolvedSelector}`,
      { action: action.action, selector: target.resolvedSelector, valueLength: action.value?.length },
    );
    if (blocked) return blocked;
    await moveCursorToLocator(this.page, target.locator);
    await this.performElementAction(target, action.action, action.value);
    if (executionOptions.waitForNetworkIdle ?? this.options.waitForNetworkIdle ?? true) {
      await this.page.waitForLoadState('networkidle', {
        timeout: executionOptions.networkIdleTimeoutMs ?? this.options.networkIdleTimeoutMs,
      }).catch(() => {});
    }
    const targetLabel = await target.locator.evaluate((element) => {
      const el = element as unknown as { getAttribute(name: string): string | null; textContent?: string | null };
      return el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 120) || el.getAttribute('name') || undefined;
    }).catch(() => undefined);
    return { success: true, url: this.page.url(), resolvedSelector: target.resolvedSelector, targetLabel };
  }

  private async observe(filter?: string): Promise<BrowserActionResult> {
    const blocked = await this.authorize('browser.read', 'Observe page elements', { filter });
    if (blocked) return blocked;
    const snapshot = await extractNumberedDOMSnapshot(this.page, filter);
    return { success: true, url: snapshot.url, elementsCount: snapshot.elements.length, domTree: snapshot.formattedDOM, elements: snapshot.elements };
  }

  private async extract(action: Extract<SemanticBrowserAction, { kind: 'extract' }>): Promise<BrowserActionResult> {
    const { selector, includeIndices = false, limit = 8000 } = action;
    const blocked = await this.authorize('browser.read', 'Extract page content', { selector, includeIndices, limit });
    if (blocked) return blocked;
    const result = await extractDOMAsMarkdown(this.page, { includeIndices, selector });
    return { success: true, url: result.url, markdown: result.markdown.slice(0, limit), totalChars: result.charCount };
  }

  private async pageUrl(): Promise<BrowserActionResult> {
    const blocked = await this.authorize('browser.read', 'Read current page URL');
    if (blocked) return blocked;
    return { success: true, url: this.page.url(), title: await this.page.title() };
  }

  private async keys(key: string): Promise<BrowserActionResult> {
    const blocked = await this.authorize('browser.keypress', `Press ${key}`, { key });
    if (blocked) return blocked;
    await this.page.keyboard.press(key);
    return { success: true };
  }

  private async type(text: string): Promise<BrowserActionResult> {
    const blocked = await this.authorize('browser.type', 'Type into focused element', { textLength: text.length });
    if (blocked) return blocked;
    await this.page.keyboard.type(text);
    return { success: true };
  }

  private async scroll(direction: 'up' | 'down' | 'left' | 'right', pixels: number): Promise<BrowserActionResult> {
    const blocked = await this.authorize('browser.scroll', `Scroll ${direction}`, { direction, pixels });
    if (blocked) return blocked;
    const dx = direction === 'right' ? pixels : direction === 'left' ? -pixels : 0;
    const dy = direction === 'down' ? pixels : direction === 'up' ? -pixels : 0;
    await this.page.evaluate((coordinates: number[]) => {
      const [x, y] = coordinates;
      const browserWindow = globalThis as unknown as { scrollBy: (left: number, top: number) => void };
      browserWindow.scrollBy(x, y);
    }, [dx, dy]);
    return { success: true };
  }

  private async resolveTarget(index?: number, selector?: string): Promise<ElementTarget> {
    if (index === undefined && !selector) throw new Error('Must specify either index or selector.');
    if (index !== undefined) return ElementTargetingEngine.resolveByIndex(this.page, index);
    return ElementTargetingEngine.resolveBySelector(this.page, selector!, this.options.targetTimeoutMs);
  }

  private async performElementAction(target: ElementTarget, action: ElementActionKind, value?: string): Promise<void> {
    switch (action) {
      case 'click': await target.locator.click({ timeout: 8000 }); break;
      case 'fill': await target.locator.fill('', { timeout: 8000 }); await target.locator.fill(value ?? '', { timeout: 8000 }); break;
      case 'press': await target.locator.press(value ?? 'Enter', { timeout: 8000 }); break;
      case 'select': await target.locator.selectOption(value ?? '', { timeout: 8000 }); break;
      case 'check': await target.locator.check({ timeout: 8000 }); break;
      case 'uncheck': await target.locator.uncheck({ timeout: 8000 }); break;
      case 'focus': await target.locator.focus({ timeout: 8000 }); break;
      case 'hover': await target.locator.hover({ timeout: 8000 }); break;
    }
  }
}

function sleep(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)); }
