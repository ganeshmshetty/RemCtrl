/**
 * @file element-targeting-engine.ts
 * @description Deep module for resolving robust Playwright locators from indices or raw selectors. Orchestrates DOM snapshots, selector generation, and AI-driven self-healing fallbacks.
 */

import { Page, Locator } from 'playwright';
import { computeStableSelector } from './selector-generator.js';

export interface TargetResolution {
  locator: Locator;
  resolvedSelector: string;
}

export class ElementTargetingEngine {
  
  /**
   * Resolves a Playwright locator based on an index provided by the LLM during an active agent run.
   * Internally generates and returns a stable selector for future replays.
   */
  static async resolveByIndex(page: Page, index: number): Promise<TargetResolution> {
    // 1. Try to find the element by the injected data attribute
    let locator = page.locator(`[data-remctrl-index="${index}"]`).first();
    
    // 2. If not found in main frame, search in child iframes
    if (await locator.count() === 0) {
      let foundInFrame = false;
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        const candidate = frame.locator(`[data-remctrl-index="${index}"]`).first();
        if (await candidate.count() > 0) {
          locator = candidate;
          foundInFrame = true;
          break;
        }
      }
      if (!foundInFrame) {
        throw new Error(`Element with index [${index}] not found in the DOM.`);
      }
    }

    // 3. Generate a stable selector for the located element
    let resolvedSelector = '';
    try {
      resolvedSelector = await computeStableSelector(locator);
      if (!resolvedSelector || resolvedSelector.trim() === '') {
        throw new Error('empty selector returned');
      }
    } catch (e) {
      resolvedSelector = `[index=${index}]`;
      console.warn(`[TargetingEngine] selector generation failed (${(e as Error).message}), using fallback: ${resolvedSelector}`);
    }

    return { locator, resolvedSelector };
  }

  /**
   * Resolves a locator strictly by a provided CSS/XPath selector (e.g. from a saved workflow step).
   * Does NOT perform self-healing itself; it throws if the element is not found, letting the caller trigger healing.
   */
  static async resolveBySelector(page: Page, selector: string, timeoutMs: number = 3000): Promise<TargetResolution> {
    let locator = page.locator(selector).first();
    
    try {
      await locator.waitFor({ state: 'attached', timeout: timeoutMs });
    } catch (e) {
      // If it fails, we try searching across frames using heuristics (similar to rawAct fallback)
      let foundInFrame = false;
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        const strategies = [
          () => frame.locator(selector).first(),
          () => frame.getByRole('button', { name: selector, exact: false }).first(),
          () => frame.getByRole('link', { name: selector, exact: false }).first()
        ];

        for (const strategy of strategies) {
          try {
            const candidate = strategy();
            await candidate.waitFor({ timeout: 1000, state: 'attached' });
            locator = candidate;
            foundInFrame = true;
            break;
          } catch {
            continue;
          }
        }
        if (foundInFrame) break;
      }
      
      if (!foundInFrame) {
        throw new Error(`Target selector "${selector}" could not be resolved.`);
      }
    }

    return { locator, resolvedSelector: selector };
  }
}
