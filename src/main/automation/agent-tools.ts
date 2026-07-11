/**
 * Agent Tools — AI SDK atomic browser tool definitions for RemoteCtrl
 *
 * Built directly on Playwright with Stagehand-inspired capabilities:
 * - observe(): Returns clean interactive DOM & accessibility tree elements with robust selectors
 * - act(): Uses multi-strategy locator chains with deterministic Playwright action execution
 * - extract(): Extracts structured readable text from the DOM / accessibility tree
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Page } from 'playwright';
import { ensureCursorOverlay, moveCursorToLocator } from './cursor-overlay.js';
import { ask } from './human-checkpoint.js';

export function createBrowserTools(
  page: Page,
  contextGetter?: () => { taskId: string; step: number; taskProgress: string; abortSignal?: AbortSignal }
) {
  return {
    goto: tool({
      description: 'Navigate to a URL',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await ensureCursorOverlay(page);
        await page.waitForLoadState('networkidle').catch(() => {});
        return { success: true, url: page.url() };
      },
    }),

    act: tool({
      description:
        'Interact with an element on the page. Provide a selector (#id, [aria-label="..."], CSS selector, or visible button/link text) and the action (click, fill, press, select, check). E.g.: { selector: "Search", action: "fill", value: "despacito" }',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector, #id, aria label, or visible text of the element'),
        action: z.enum(['click', 'fill', 'press', 'select', 'check', 'uncheck', 'focus', 'hover']),
        value: z.string().optional().describe('Value to fill/type/select (for fill, press, select actions)'),
      }),
      execute: async ({ selector, action, value }) => {
        // Multi-strategy locator resolution
        const strategies = [
          () => page.locator(selector).first(),
          () => page.getByRole('button', { name: selector, exact: false }).first(),
          () => page.getByRole('link', { name: selector, exact: false }).first(),
          () => page.getByRole('textbox', { name: selector, exact: false }).first(),
          () => page.getByRole('searchbox', { name: selector, exact: false }).first(),
          () => page.getByLabel(selector, { exact: false }).first(),
          () => page.getByPlaceholder(selector, { exact: false }).first(),
          () => page.getByText(selector, { exact: false }).first(),
        ];

        let locator: any = null;
        for (const strategy of strategies) {
          try {
            const candidate = strategy();
            await candidate.waitFor({ timeout: 2000, state: 'attached' });
            locator = candidate;
            break;
          } catch {
            continue;
          }
        }

        if (!locator) {
          throw new Error(`Element not found matching selector or name: "${selector}". Try calling observe() first to find exact selectors.`);
        }

        await moveCursorToLocator(page, locator);

        switch (action) {
          case 'click':
            await locator.click({ timeout: 8000 });
            break;
          case 'fill':
            await locator.fill('', { timeout: 8000 }); // clear first (Stagehand pattern)
            await locator.fill(value ?? '', { timeout: 8000 });
            break;
          case 'press':
            await locator.press(value ?? 'Enter', { timeout: 8000 });
            break;
          case 'select':
            await locator.selectOption(value ?? '', { timeout: 8000 });
            break;
          case 'check':
            await locator.check({ timeout: 8000 });
            break;
          case 'uncheck':
            await locator.uncheck({ timeout: 8000 });
            break;
          case 'focus':
            await locator.focus({ timeout: 8000 });
            break;
          case 'hover':
            await locator.hover({ timeout: 8000 });
            break;
        }

        await page.waitForLoadState('networkidle').catch(() => {});
        return { success: true, url: page.url() };
      },
    }),

    observe: tool({
      description:
        'Scan the page DOM for interactive elements (inputs, search boxes, buttons, links, selects). Returns structured elements with reliable selectors you can use with act(). Always call observe() on a new page.',
      inputSchema: z.object({
        filter: z.string().optional().describe('Optional keyword to filter elements by label, text, or id'),
      }),
      execute: async ({ filter }) => {
        const elements: any[] = await page.evaluate((filterKw: string | undefined) => {
          const doc = (globalThis as any).document;
          if (!doc) return [];
          const results: any[] = [];
          const seen = new Set<string>();

          const selectors = [
            'input:not([type="hidden"])',
            'textarea',
            'select',
            'button',
            'a[href]',
            '[role="button"]',
            '[role="link"]',
            '[role="combobox"]',
            '[role="searchbox"]',
            '[contenteditable="true"]',
          ];

          for (const sel of selectors) {
            const nodes = Array.from(doc.querySelectorAll(sel)).slice(0, 40);
            for (const el of nodes) {
              const e = el as any;
              const text = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
              const label =
                e.getAttribute('aria-label') ||
                e.getAttribute('placeholder') ||
                e.getAttribute('name') ||
                e.getAttribute('title') ||
                '';
              const id = e.id ? `#${e.id}` : '';
              const type = e.type || e.tagName.toLowerCase();
              const key = `${sel}:${id}:${label}:${text}`;
              if (seen.has(key)) continue;
              seen.add(key);

              if (filterKw) {
                const kw = filterKw.toLowerCase();
                if (
                  !text.toLowerCase().includes(kw) &&
                  !label.toLowerCase().includes(kw) &&
                  !id.toLowerCase().includes(kw)
                ) {
                  continue;
                }
              }

              let selector = id;
              if (!selector && label) {
                // Prefix with tag to disambiguate (e.g. input[aria-label="Search"] vs button[aria-label="Search"])
                selector = `${e.tagName.toLowerCase()}[aria-label="${label}"]`;
              }
              if (!selector && e.getAttribute('name')) {
                selector = `${e.tagName.toLowerCase()}[name="${e.getAttribute('name')}"]`;
              }
              if (!selector && e.getAttribute('placeholder')) {
                selector = `${e.tagName.toLowerCase()}[placeholder="${e.getAttribute('placeholder')}"]`;
              }
              if (!selector && text && text.length < 40) {
                selector = text;
              }
              if (!selector) {
                selector = sel;
              }

              results.push({
                tag: e.tagName.toLowerCase(),
                type,
                id,
                label,
                text,
                selector,
              });
            }
          }
          return results.slice(0, 40);
        }, filter);

        return { url: page.url(), elements };
      },
    }),

    extract: tool({
      description: 'Extract structured text content from the page or a specific element selector.',
      inputSchema: z.object({
        selector: z.string().optional().describe('CSS selector to scope extraction (defaults to entire body)'),
        limit: z.number().optional().default(4000).describe('Max characters to return'),
      }),
      execute: async ({ selector, limit = 4000 }) => {
        const text: string = await page.evaluate(([sel, lim]: [string | undefined, number]) => {
          const doc = (globalThis as any).document;
          if (!doc) return '';
          const root = sel ? doc.querySelector(sel) : doc.body;
          if (!root) return '';
          const lines: string[] = [];
          const walk = (node: any) => {
            if (node.nodeType === 3) { // TEXT_NODE
              const val = node.nodeValue?.replace(/\s+/g, ' ').trim();
              if (val) lines.push(val);
            } else if (node.nodeType === 1) { // ELEMENT_NODE
              const tag = node.tagName.toLowerCase();
              if (['script', 'style', 'noscript', 'svg'].includes(tag)) return;
              if (tag === 'input' || tag === 'textarea') {
                const val = node.value?.trim();
                if (val) lines.push(`[Input value: ${val}]`);
              }
              for (const child of Array.from(node.childNodes)) {
                walk(child);
              }
              if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'tr', 'br'].includes(tag)) {
                lines.push('\n');
              }
            }
          };
          walk(root);
          return lines.join(' ').replace(/\n\s+/g, '\n').replace(/\s+/g, ' ').trim().slice(0, lim);
        }, [selector, limit] as [string | undefined, number]);

        return { url: page.url(), text };
      },
    }),

    getPageUrl: tool({
      description: 'Get the current page URL and title.',
      inputSchema: z.object({}),
      execute: async () => {
        const title: string = await page.title();
        return { url: page.url(), title };
      },
    }),

    keys: tool({
      description: 'Press a keyboard key globally (e.g. Enter, Tab, Escape, ArrowDown)',
      inputSchema: z.object({ key: z.string() }),
      execute: async ({ key }) => {
        await page.keyboard.press(key);
        return { success: true };
      },
    }),

    type: tool({
      description: 'Type text into the currently focused element (use after clicking/focusing an input)',
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        await page.keyboard.type(text);
        return { success: true };
      },
    }),

    scroll: tool({
      description: 'Scroll the page up, down, left, or right by a number of pixels',
      inputSchema: z.object({
        direction: z.enum(['up', 'down', 'left', 'right']),
        pixels: z.number().min(50).max(5000).default(500),
      }),
      execute: async ({ direction, pixels }) => {
        const dx = direction === 'right' ? pixels : direction === 'left' ? -pixels : 0;
        const dy = direction === 'down' ? pixels : direction === 'up' ? -pixels : 0;
        await page.evaluate((args: number[]) => {
          const win = (globalThis as any).window;
          if (win && args[0] !== undefined && args[1] !== undefined) win.scrollBy(args[0], args[1]);
        }, [dx, dy]);
        return { success: true };
      },
    }),

    wait: tool({
      description: 'Wait for a number of milliseconds before continuing',
      inputSchema: z.object({ ms: z.number().min(100).max(10000).default(1000) }),
      execute: async ({ ms }) => {
        await new Promise((r) => setTimeout(r, ms));
        return { success: true };
      },
    }),

    askUser: tool({
      description:
        'Pause execution and ask the user for help when you run into a CAPTCHA, a 2FA OTP prompt, need target preferences, or encounter a roadblock you cannot bypass on your own. Describe the situation clearly and offer options for the user to choose from.',
      inputSchema: z.object({
        question: z.string().describe('Explain the situation and what you need the user to do (e.g. "I encountered a CAPTCHA, please solve it on screen" or "Please enter the 2FA OTP sent to your phone").'),
        options: z.array(z.object({
          id: z.string().describe('Short machine-readable identifier for the option, e.g. "solved" or "option_a"'),
          label: z.string().describe('Human-readable button label, e.g. "I solved the CAPTCHA!" or "Select Option A"')
        })).min(1).describe('The list of choices/actions you want to present to the user.')
      }),
      execute: async ({ question, options }) => {
        if (!contextGetter) {
          throw new Error('Human checkpoint is not available in this context.');
        }
        const ctx = contextGetter();
        const selectedOptionId = await ask(
          ctx.taskId,
          ctx.step,
          question,
          options,
          {
            currentPage: page.url(),
            taskProgress: ctx.taskProgress,
            uncertainty: question
          },
          10 * 60 * 1000,
          ctx.abortSignal
        );
        return { success: true, selectedOptionId };
      }
    }),

    think: tool({
      description:
        'Reason about the task without taking a browser action. Use this to plan before acting.',
      inputSchema: z.object({ thought: z.string() }),
      execute: async ({ thought }) => ({ thought }),
    }),

    done: tool({
      description:
        'Signal that the current goal is fully achieved. Call ONLY when the task is complete.',
      inputSchema: z.object({
        taskComplete: z.boolean(),
        message: z.string().describe('A summary of what was accomplished'),
      }),
      execute: async ({ message }) => ({ message }),
    }),
  };
}

export type BrowserTools = ReturnType<typeof createBrowserTools>;
