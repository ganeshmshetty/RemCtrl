/**
 * Visual Cursor Overlay — Stagehand-style Agent Mode Pointer
 *
 * Injects a persistent visual mouse cursor overlay into the active Playwright Page
 * and glides smoothly to target coordinates/elements during AI interactions.
 */

import type { Page, Locator } from 'playwright';

const CURSOR_INIT_SCRIPT = `(() => {
  if (window !== window.top) return;
  const ID = '__v3_cursor_overlay__';
  const state = { el: null, last: null };
  try {
    if (!window.__v3Cursor || !window.__v3Cursor.__installed) {
      const api = {
        __installed: false,
        move(x, y) {
          if (state.el) {
            state.el.style.left = Math.max(0, x) + 'px';
            state.el.style.top = Math.max(0, y) + 'px';
          } else {
            state.last = [x, y];
          }
        },
        show() { if (state.el) state.el.style.display = 'block'; },
        hide() { if (state.el) state.el.style.display = 'none'; },
      };
      window.__v3Cursor = api;
    }
  } catch {}

  function install() {
    try {
      if (state.el) return;
      let el = document.getElementById(ID);
      if (!el) {
        const root = document.documentElement || document.body || document.head;
        if (!root) { setTimeout(install, 50); return; }
        el = document.createElement('div');
        el.id = ID;
        el.style.position = 'fixed';
        el.style.left = '40px';
        el.style.top = '40px';
        el.style.width = '20px';
        el.style.height = '28px';
        el.style.zIndex = '2147483647';
        el.style.pointerEvents = 'none';
        el.style.userSelect = 'none';
        el.style.transition = 'left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
        el.style.willChange = 'left, top';
        el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28"><path d="M1.5 1.5 L1.5 24 L7.5 16 L17.5 16 Z" fill="#6366f1" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>';
        root.appendChild(el);
      }
      state.el = el;
      try { window.__v3Cursor.__installed = true; } catch {}
      if (state.last) {
        window.__v3Cursor.move(state.last[0], state.last[1]);
        state.last = null;
      }
    } catch {}
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    install();
  } else {
    document.addEventListener('DOMContentLoaded', install, { once: true });
    setTimeout(install, 100);
  }
})();`;

const registeredPages = new WeakSet<Page>();

export async function ensureCursorOverlay(page: Page): Promise<void> {
  try {
    if (!registeredPages.has(page)) {
      await page.addInitScript(CURSOR_INIT_SCRIPT).catch(() => {});
      registeredPages.add(page);
    }
    await page.evaluate(CURSOR_INIT_SCRIPT).catch(() => {});
  } catch {
    // page closed or navigation ongoing
  }
}

export async function moveCursorTo(page: Page, x: number, y: number): Promise<void> {
  await ensureCursorOverlay(page);
  try {
    await page.evaluate(
      ([cx, cy]) => {
        const win = (globalThis as any).window;
        const cur = win ? win.__v3Cursor : (globalThis as any).__v3Cursor;
        if (cur && typeof cur.move === 'function') {
          cur.move(cx, cy);
        }
      },
      [Math.round(x), Math.round(y)],
    );
  } catch {
    // ignore evaluate errors during fast navigation
  }
}

export async function moveCursorToLocator(page: Page, locator: Locator): Promise<void> {
  try {
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await moveCursorTo(page, cx, cy);
      await new Promise((r) => setTimeout(r, 160));
    }
  } catch {
    // ignore if boundingBox fails
  }
}
