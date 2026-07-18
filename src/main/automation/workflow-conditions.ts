import type { Page } from 'playwright';
import type { WorkflowStep } from '../../shared/types.js';
import { throwIfAborted, waitFor } from './abortable.js';

export type WorkflowPostcondition = NonNullable<WorkflowStep['postcondition']>;
type QueryNode = { textContent?: string | null; getAttribute(name: string): string | null };
type QueryDocument = { querySelectorAll(selector: string): ArrayLike<QueryNode> };

export interface WorkflowConditionOptions {
  /** Maximum time to wait for a condition to become true. */
  timeoutMs?: number;
  /** Delay between `check` step evaluations. */
  pollIntervalMs?: number;
  /** Delay between postcondition evaluations. Defaults to the legacy 150ms. */
  postconditionPollIntervalMs?: number;
  /** Injectable delay for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  abortSignal?: AbortSignal;
}

/**
 * Deep module for browser-backed workflow conditions.
 *
 * Workflow orchestration only needs to ask whether a condition passed. The
 * Playwright selectors, polling, and tolerant page-state reads stay behind
 * this small interface so adding another condition does not spread browser
 * details through the workflow executor.
 */
export class WorkflowConditionEngine {
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly postconditionPollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly abortSignal?: AbortSignal;

  constructor(private readonly page: Page, options: WorkflowConditionOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.postconditionPollIntervalMs = options.postconditionPollIntervalMs ?? 150;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.abortSignal = options.abortSignal;
  }

  async verify(postcondition: WorkflowPostcondition): Promise<void> {
    const passed = await this.waitFor(() => this.matchesPostcondition(postcondition), this.postconditionPollIntervalMs);
    if (!passed) throw new Error(`Postcondition failed: ${postcondition.kind}`);
  }

  async check(condition: string): Promise<boolean> {
    return this.waitFor(() => this.pageContains(condition), this.pollIntervalMs);
  }

  private async waitFor(predicate: () => Promise<boolean>, pollIntervalMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, this.timeoutMs);
    do {
      throwIfAborted(this.abortSignal);
      if (await predicate()) return true;
      if (Date.now() >= deadline) break;
      const delay = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
      if (this.abortSignal) await waitFor(delay, this.abortSignal);
      else await this.sleep(delay);
    } while (Date.now() < deadline);
    return false;
  }

  private async matchesPostcondition(postcondition: WorkflowPostcondition): Promise<boolean> {
    if (postcondition.kind === 'url_includes') return this.page.url().includes(postcondition.value);
    if (postcondition.kind === 'selector_visible') {
      return this.page.locator(postcondition.value).first().isVisible().catch(() => false);
    }
    if (postcondition.kind === 'text_visible') {
      return this.page.getByText(postcondition.value, { exact: false }).first().isVisible().catch(() => false);
    }
    if (postcondition.kind === 'field_value' || postcondition.kind === 'selected_value') {
      return this.page.locator(postcondition.selector).first().inputValue()
        .then((value) => value === postcondition.value)
        .catch(() => false);
    }
    return false;
  }

  private async pageContains(condition: string): Promise<boolean> {
    return this.page.evaluate((query: string) => {
      const doc = (globalThis as unknown as { document?: QueryDocument }).document;
      if (!doc) return false;
      const normalized = query.toLowerCase();
      const nodes = Array.from(doc.querySelectorAll(
        'input, button, a, select, [role="button"], [role="alert"], h1, h2, h3, p, span, div',
      ));
      return nodes.some((node) => {
        const element = node as QueryNode;
        const text = (element.textContent || '').trim().toLowerCase();
        const label = (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').toLowerCase();
        return text.includes(normalized) || label.includes(normalized);
      });
    }, condition);
  }
}
