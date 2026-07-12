/**
 * Visual Orchestration Engine — Smooth Animated Cursor Glide & Click Ripple
 *
 * Provides Stagehand-inspired sleek pointer movement and visual click ripple
 * without injecting obstructive overlays or badges on DOM elements.
 */

import type { Page, Locator } from 'playwright';

const CURSOR_INIT_SCRIPT = `(() => {
  if (window !== window.top) return;
  const ID = '__remctrl_cursor_overlay__';

  const state = { el: null, last: null };

  try {
    if (!window.__remCtrlVisual || !window.__remCtrlVisual.__installed) {
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
        ripple(x, y) {
          const root = document.documentElement || document.body;
          if (!root) return;
          const r = document.createElement('div');
          r.style.position = 'fixed';
          r.style.left = (x - 6) + 'px';
          r.style.top = (y - 6) + 'px';
          r.style.width = '12px';
          r.style.height = '12px';
          r.style.borderRadius = '50%';
          r.style.border = '2px solid #6366f1';
          r.style.backgroundColor = 'rgba(99, 102, 241, 0.25)';
          r.style.zIndex = '2147483646';
          r.style.pointerEvents = 'none';
          r.style.transition = 'transform 0.4s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.4s ease-out';
          r.style.transform = 'scale(1)';
          r.style.opacity = '0.9';
          root.appendChild(r);

          requestAnimationFrame(() => {
            r.style.transform = 'scale(4.2)';
            r.style.opacity = '0';
          });

          setTimeout(() => r.remove(), 420);
        },
        show() { if (state.el) state.el.style.display = 'block'; },
        hide() { if (state.el) state.el.style.display = 'none'; },
      };
      window.__remCtrlVisual = api;
      window.__v3Cursor = api;
    }
  } catch {}

  function install() {
    try {
      const root = document.documentElement || document.body || document.head;
      if (!root) { setTimeout(install, 50); return; }

      if (!state.el) {
        let el = document.getElementById(ID);
        if (!el) {
          el = document.createElement('div');
          el.id = ID;
          el.setAttribute('data-remctrl-exclude', 'true');
          el.style.position = 'fixed';
          el.style.left = '40px';
          el.style.top = '40px';
          el.style.width = '24px';
          el.style.height = '24px';
          el.style.zIndex = '2147483647';
          el.style.pointerEvents = 'none';
          el.style.userSelect = 'none';
          el.style.transition = 'left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
          el.style.willChange = 'left, top';
          el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));"><path d="M4 3 L4 19.5 C4 20.2 4.8 20.6 5.3 20.1 L9.8 15.6 C10.1 15.3 10.5 15.1 10.9 15.1 L18.5 15.1 C19.2 15.1 19.6 14.3 19.1 13.8 L5.4 3.3 C4.9 2.9 4 3.3 4 3 Z" fill="#6366f1" stroke="white" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
          root.appendChild(el);
        }
        state.el = el;
        try { window.__remCtrlVisual.__installed = true; } catch {}
        if (state.last) {
          window.__remCtrlVisual.move(state.last[0], state.last[1]);
          state.last = null;
        }
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
        const cur = win ? win.__remCtrlVisual || win.__v3Cursor : null;
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

export async function triggerRipple(page: Page, x: number, y: number): Promise<void> {
  await ensureCursorOverlay(page);
  try {
    await page.evaluate(
      ([cx, cy]) => {
        const win = (globalThis as any).window;
        const cur = win ? win.__remCtrlVisual : null;
        if (cur && typeof cur.ripple === 'function') {
          cur.ripple(cx, cy);
        }
      },
      [Math.round(x), Math.round(y)],
    );
  } catch {}
}

export async function moveCursorToLocator(page: Page, locator: Locator): Promise<void> {
  try {
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Smoothly glide cursor to target center
      await moveCursorTo(page, cx, cy);
      // Pause briefly so user observes the cursor arrival (matches the 0.22s CSS transition)
      await new Promise((r) => setTimeout(r, 240));
      // Trigger visual click ripple
      await triggerRipple(page, cx, cy);
    }
  } catch {
    // ignore if boundingBox fails
  }
}
