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
import { extractNumberedDOMSnapshot, extractDOMAsMarkdown } from './dom-snapshot.js';
import { ask } from './human-checkpoint.js';

class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.locked = false;
    const next = this.queue.shift();
    if (next) next();
  }
}

export function createBrowserTools(
  page: Page,
  contextGetter?: () => { taskId: string; step: number; taskProgress: string; abortSignal?: AbortSignal }
) {
  const toolMutex = new Mutex();

  const wrap = <Args, Ret>(fn: (args: Args, opts: any) => Promise<Ret>) => {
    return async (args: Args, opts: any) => {
      const release = await toolMutex.acquire();
      try {
        const promise = fn(args, opts);
        if (opts?.abortSignal) {
          if (opts.abortSignal.aborted) throw new Error('Cancelled by user');
          return await new Promise<Ret>((resolve, reject) => {
            const onAbort = () => reject(new Error('Cancelled by user'));
            opts.abortSignal.addEventListener('abort', onAbort);
            promise.then(resolve, reject).finally(() => {
              opts.abortSignal.removeEventListener('abort', onAbort);
            });
          });
        }
        return await promise;
      } finally {
        release();
      }
    };
  };

  const baseTools = {
    goto: tool({
      description: 'Navigate to a URL',
      inputSchema: z.object({ url: z.string() }),
      execute: wrap(async ({ url }) => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await ensureCursorOverlay(page);
        await page.waitForLoadState('networkidle').catch(() => {});
        return { success: true, url: page.url() };
      }),
    }),

    act: tool({
      description:
        'Interact with an element on the page. Provide the index [1], [2] returned by observe() OR a selector (#id, [aria-label="..."], visible text) and the action (click, fill, press, select, check). E.g.: { index: 2, action: "fill", value: "despacito" }',
      inputSchema: z.object({
        index: z.number().optional().describe('Numbered element index [1], [2], [3] returned from observe tool (preferred if observe was called)'),
        selector: z.string().optional().describe('CSS selector, #id, aria label, or visible text of the element'),
        action: z.enum(['click', 'fill', 'press', 'select', 'check', 'uncheck', 'focus', 'hover']),
        value: z.string().optional().describe('Value to fill/type/select (for fill, press, select actions)'),
      }),
      execute: wrap(async ({ index, selector, action, value }) => {
        if (index === undefined && !selector) {
          throw new Error('Must specify either index or selector for act().');
        }

        let locator: any = null;

        // 1. First attempt: Search by index across all frames
        if (index !== undefined) {
          for (const frame of page.frames()) {
            if (frame.isDetached()) continue;
            try {
              const candidate = frame.locator(`[data-remctrl-index="${index}"]`).first();
              await candidate.waitFor({ timeout: 1500, state: 'attached' });
              locator = candidate;
              break;
            } catch {
              continue;
            }
          }
        }

        // 2. Fallback / Stale Reference Recovery: Search by selector or semantic roles across all frames
        if (!locator && selector) {
          for (const frame of page.frames()) {
            if (frame.isDetached()) continue;
            const strategies = [
              () => frame.locator(selector).first(),
              () => frame.getByRole('button', { name: selector, exact: false }).first(),
              () => frame.getByRole('link', { name: selector, exact: false }).first(),
              () => frame.getByRole('textbox', { name: selector, exact: false }).first(),
              () => frame.getByRole('searchbox', { name: selector, exact: false }).first(),
              () => frame.getByLabel(selector, { exact: false }).first(),
              () => frame.getByPlaceholder(selector, { exact: false }).first(),
              () => frame.getByText(selector, { exact: false }).first(),
            ];

            for (const strategy of strategies) {
              try {
                const candidate = strategy();
                await candidate.waitFor({ timeout: 1000, state: 'attached' });
                locator = candidate;
                break;
              } catch {
                continue;
              }
            }
            if (locator) break;
          }
        }

        if (!locator) {
          const identifier = index !== undefined ? `[index=${index}]` : `"${selector}"`;
          throw new Error(`Element not found matching ${identifier} across any frame or shadow root. Try calling observe() first to refresh indices.`);
        }

        // Glide cursor smoothly and fire ripple animation
        await moveCursorToLocator(page, locator);

        switch (action) {
          case 'click':
            await locator.click({ timeout: 8000 });
            break;
          case 'fill':
            await locator.fill('', { timeout: 8000 });
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

        let resolvedSelector = selector;
        if (!resolvedSelector && locator) {
          try {
            resolvedSelector = await locator.evaluate((el: any) => {
              let sel = el.tagName.toLowerCase();
              if (el.id) sel += '#' + el.id;
              if (el.getAttribute('aria-label')) sel += `[aria-label="${el.getAttribute('aria-label')}"]`;
              if (el.getAttribute('name')) sel += `[name="${el.getAttribute('name')}"]`;
              if (el.textContent && el.textContent.trim().length > 0) {
                const text = el.textContent.trim().substring(0, 30).replace(/"/g, '\\"').replace(/\n/g, ' ');
                sel += ` (text: "${text}")`;
              }
              return sel;
            });
          } catch (e) {
            resolvedSelector = index !== undefined ? `[index=${index}]` : 'unknown';
          }
        }

        await page.waitForLoadState('networkidle').catch(() => {});
        return { success: true, url: page.url(), resolvedSelector };
      }),
    }),

    observe: tool({
      description:
        'Scan the page DOM for interactive elements (inputs, buttons, links, selects). Returns numbered elements [1], [2], [3] in browser-use format so you can pass their exact index to act(). Always call observe() before acting on a new page.',
      inputSchema: z.object({
        filter: z.string().optional().describe('Optional keyword to filter elements by label, text, or id'),
      }),
      execute: wrap(async ({ filter }) => {
        const snapshot = await extractNumberedDOMSnapshot(page, filter);
        return {
          url: snapshot.url,
          elementsCount: snapshot.elements.length,
          domTree: snapshot.formattedDOM,
          elements: snapshot.elements,
        };
      }),
    }),

    extract: tool({
      description: 'Extract structured clean Markdown content from the page (or a specific element selector). Automatically strips scripts, styles, and SPA JSON blobs to save tokens.',
      inputSchema: z.object({
        selector: z.string().optional().describe('CSS selector to scope extraction (defaults to entire page)'),
        includeIndices: z.boolean().optional().default(false).describe('Whether to embed [N] interactive element index markers inside markdown output'),
        limit: z.number().optional().default(8000).describe('Max characters to return'),
      }),
      execute: wrap(async ({ selector, includeIndices = false, limit = 8000 }) => {
        const mdResult = await extractDOMAsMarkdown(page, { includeIndices, selector });
        return {
          url: mdResult.url,
          markdown: mdResult.markdown.slice(0, limit),
          totalChars: mdResult.charCount,
        };
      }),
    }),

    getPageUrl: tool({
      description: 'Get the current page URL and title.',
      inputSchema: z.object({}),
      execute: wrap(async () => {
        const title: string = await page.title();
        return { url: page.url(), title };
      }),
    }),

    keys: tool({
      description: 'Press a keyboard key globally (e.g. Enter, Tab, Escape, ArrowDown)',
      inputSchema: z.object({ key: z.string() }),
      execute: wrap(async ({ key }) => {
        await page.keyboard.press(key);
        return { success: true };
      }),
    }),

    type: tool({
      description: 'Type text into the currently focused element (use after clicking/focusing an input)',
      inputSchema: z.object({ text: z.string() }),
      execute: wrap(async ({ text }) => {
        await page.keyboard.type(text);
        return { success: true };
      }),
    }),

    scroll: tool({
      description: 'Scroll the page up, down, left, or right by a number of pixels',
      inputSchema: z.object({
        direction: z.enum(['up', 'down', 'left', 'right']),
        pixels: z.number().min(50).max(5000).default(500),
      }),
      execute: wrap(async ({ direction, pixels }) => {
        const dx = direction === 'right' ? pixels : direction === 'left' ? -pixels : 0;
        const dy = direction === 'down' ? pixels : direction === 'up' ? -pixels : 0;
        await page.evaluate((args: number[]) => {
          const win = (globalThis as any).window;
          if (win && args[0] !== undefined && args[1] !== undefined) win.scrollBy(args[0], args[1]);
        }, [dx, dy]);
        return { success: true };
      }),
    }),

    wait: tool({
      description: 'Wait for a number of milliseconds before continuing',
      inputSchema: z.object({ ms: z.number().min(100).max(10000).default(1000) }),
      execute: wrap(async ({ ms }) => {
        await new Promise((r) => setTimeout(r, ms));
        return { success: true };
      }),
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
      execute: wrap(async ({ question, options }) => {
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
      }),
    }),

    think: tool({
      description:
        'Reason about the task without taking a browser action. Use this to plan before acting.',
      inputSchema: z.object({ thought: z.string() }),
      execute: wrap(async ({ thought }) => ({ thought })),
    }),

    notifyUser: tool({
      description:
        'Send an informative progress update or status message to the user mid-task without pausing execution.',
      inputSchema: z.object({
        message: z.string().describe('Clear, helpful status message for the user (e.g. "Successfully logged in, now searching for flights...")'),
      }),
      execute: wrap(async ({ message }) => ({ success: true, message })),
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

  // Raw unwrapped implementations for tools usable inside runActionSequence.
  // These are called directly (without re-acquiring the mutex) since the
  // parent runActionSequence already holds the lock.
  const rawAct = async (args: { index?: number; selector?: string; action: 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck' | 'focus' | 'hover'; value?: string }) => {
    const { index, selector, action, value } = args;
    if (index === undefined && !selector) throw new Error('Must specify either index or selector for act().');
    let locator: any = null;
    if (index !== undefined) {
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        try {
          const c = frame.locator(`[data-remctrl-index="${index}"]`).first();
          await c.waitFor({ timeout: 1500, state: 'attached' });
          locator = c; break;
        } catch { continue; }
      }
    }
    if (!locator && selector) {
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        const strategies = [
          () => frame.locator(selector).first(),
          () => frame.getByRole('button', { name: selector, exact: false }).first(),
          () => frame.getByRole('link', { name: selector, exact: false }).first(),
          () => frame.getByRole('textbox', { name: selector, exact: false }).first(),
          () => frame.getByLabel(selector, { exact: false }).first(),
          () => frame.getByText(selector, { exact: false }).first(),
        ];
        for (const s of strategies) {
          try { const c = s(); await c.waitFor({ timeout: 1000, state: 'attached' }); locator = c; break; } catch { continue; }
        }
        if (locator) break;
      }
    }
    if (!locator) throw new Error(`Element not found for act() in runActionSequence.`);
    await moveCursorToLocator(page, locator);
    switch (action) {
      case 'click': await locator.click({ timeout: 8000 }); break;
      case 'fill': await locator.fill('', { timeout: 8000 }); await locator.fill(value ?? '', { timeout: 8000 }); break;
      case 'press': await locator.press(value ?? 'Enter', { timeout: 8000 }); break;
      case 'select': await locator.selectOption(value ?? '', { timeout: 8000 }); break;
      case 'check': await locator.check({ timeout: 8000 }); break;
      case 'uncheck': await locator.uncheck({ timeout: 8000 }); break;
      case 'focus': await locator.focus({ timeout: 8000 }); break;
      case 'hover': await locator.hover({ timeout: 8000 }); break;
    }
    return { success: true };
  };
  const rawType = async (args: { text: string }) => { await page.keyboard.type(args.text); return { success: true }; };
  const rawKeys = async (args: { key: string }) => { await page.keyboard.press(args.key); return { success: true }; };
  const rawScroll = async (args: { direction: 'up' | 'down' | 'left' | 'right'; pixels: number }) => {
    const px = args.pixels ?? 500;
    const dx = args.direction === 'right' ? px : args.direction === 'left' ? -px : 0;
    const dy = args.direction === 'down' ? px : args.direction === 'up' ? -px : 0;
    await page.evaluate((a: number[]) => { (globalThis as any).window?.scrollBy(a[0], a[1]); }, [dx, dy]);
    return { success: true };
  };
  const rawWait = async (args: { ms: number }) => { await new Promise((r) => setTimeout(r, args.ms ?? 1000)); return { success: true }; };

  const rawImpls: Record<string, (args: any) => Promise<any>> = {
    act: rawAct,
    type: rawType,
    keys: rawKeys,
    scroll: rawScroll,
    wait: rawWait,
  };

  const tools = {
    ...baseTools,
    runActionSequence: tool({
      description: 'Execute a sequence of browser actions in strict order within a single turn to save time (e.g. fill an input, then type, then press Enter).',
      inputSchema: z.object({
        actions: z.array(
          z.object({
            toolName: z.enum(['act', 'type', 'keys', 'scroll', 'wait']),
            args: z.any().describe('The arguments matching the schema for the specified tool'),
          })
        ).min(1).max(10).describe('List of actions to execute sequentially'),
      }),
      // runActionSequence acquires the mutex once via wrap(), then calls the
      // raw (non-wrapped) implementations directly to avoid a mutex deadlock.
      execute: wrap(async ({ actions }) => {
        const results = [];
        for (const action of actions) {
          const impl = rawImpls[action.toolName];
          if (impl) {
            try {
              results.push({ tool: action.toolName, result: await impl(action.args) });
            } catch (err: any) {
              results.push({ tool: action.toolName, error: err.message || String(err) });
              return { success: false, results, stoppedAt: action.toolName };
            }
          } else {
            results.push({ tool: action.toolName, error: 'Unknown tool' });
            return { success: false, results, stoppedAt: action.toolName };
          }
        }
        return { success: true, results };
      }),
    }),
  };

  return tools;
}

export type BrowserTools = ReturnType<typeof createBrowserTools>;
