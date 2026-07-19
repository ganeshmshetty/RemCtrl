import type { Page } from 'playwright';

export interface VisualGuidanceMark {
  id: number;
  tagName: string;
  role?: string;
  label?: string;
  rect: { x: number; y: number; width: number; height: number };
  normalized: { x: number; y: number; width: number; height: number };
}

export interface VisualGuidanceAxisGrid {
  step: number;
  x: number[];
  y: number[];
}

export interface VisualGuidanceCapture {
  screenshot: Buffer;
  viewport: { width: number; height: number };
  marks: VisualGuidanceMark[];
  axisGrid: VisualGuidanceAxisGrid;
}

interface InjectedGuidance {
  viewport: { width: number; height: number };
  marks: VisualGuidanceMark[];
  axisGrid: VisualGuidanceAxisGrid;
}

const OVERLAY_SELECTOR = '#remctrl-overlay-root';

/** Captures one transient, self-excluding visual guide for the current page. */
export async function captureVisualGuidance(page: Page): Promise<VisualGuidanceCapture> {
  let guidance: InjectedGuidance | undefined;

  try {
    guidance = await page.evaluate<InjectedGuidance>(() => {
      const doc = (globalThis as any).document;
      const win = (globalThis as any).window;
      const existing = doc.querySelectorAll('#remctrl-overlay-root');
      existing.forEach((element: any) => element.remove());

      const width = Math.max(1, win.innerWidth || doc.documentElement.clientWidth);
      const height = Math.max(1, win.innerHeight || doc.documentElement.clientHeight);
      const root = doc.createElement('div');
      root.id = 'remctrl-overlay-root';
      root.setAttribute('data-remctrl-exclude', 'true');
      root.setAttribute('data-remctrl-overlay', 'true');
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;user-select:none;';

      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      const grid = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      grid.setAttribute('opacity', '0.28');
      const step = 0.1;
      const x: number[] = [];
      const y: number[] = [];
      for (let i = 0; i <= 10; i += 1) {
        const nx = i / 10;
        x.push(nx);
        y.push(nx);
        const vertical = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
        vertical.setAttribute('x1', String(width * nx));
        vertical.setAttribute('x2', String(width * nx));
        vertical.setAttribute('y1', '0');
        vertical.setAttribute('y2', String(height));
        vertical.setAttribute('stroke', '#22d3ee');
        vertical.setAttribute('stroke-width', '1');
        grid.appendChild(vertical);
        const horizontal = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
        horizontal.setAttribute('x1', '0');
        horizontal.setAttribute('x2', String(width));
        horizontal.setAttribute('y1', String(height * nx));
        horizontal.setAttribute('y2', String(height * nx));
        horizontal.setAttribute('stroke', '#22d3ee');
        horizontal.setAttribute('stroke-width', '1');
        grid.appendChild(horizontal);
      }
      svg.appendChild(grid);
      root.appendChild(svg);
      doc.documentElement.appendChild(root);

      const interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);
      const interactiveRoles = new Set(['button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab', 'textbox', 'combobox', 'slider', 'spinbutton', 'search', 'searchbox']);
      const marks: VisualGuidanceMark[] = [];
      const candidates: any[] = [];
      const seen = new Set<any>();
      const collect = (node: any): void => {
        for (const child of Array.from(node.children || node.childNodes || []) as any[]) {
          if (!child || child.nodeType !== 1 || seen.has(child)) continue;
          seen.add(child);
          candidates.push(child);
          if (child.shadowRoot) collect(child.shadowRoot);
          collect(child);
        }
      };
      collect(doc.documentElement);

      const hasFormControlDescendant = (element: any, depth = 2): boolean => {
        if (!element || depth <= 0) return false;
        for (const child of Array.from(element.children || element.childNodes || []) as any[]) {
          const tag = child?.tagName?.toLowerCase();
          if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
          if (child?.shadowRoot && hasFormControlDescendant(child.shadowRoot, depth - 1)) return true;
          if (hasFormControlDescendant(child, depth - 1)) return true;
        }
        return false;
      };

      for (const element of candidates) {
        if (element.closest('[data-remctrl-exclude]')) continue;
        const style = win.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const tagName = element.tagName.toLowerCase();
        const role = element.getAttribute('role') || undefined;
        const wrapperControl = (tagName === 'label' && !element.hasAttribute('for') || tagName === 'span') && hasFormControlDescendant(element);
        const interactive = interactiveTags.has(tagName) || (role ? interactiveRoles.has(role) : false) || wrapperControl || element.isContentEditable === true || element.getAttribute('contenteditable') === 'true' || element.tabIndex >= 0 || style.cursor === 'pointer' || element.hasAttribute('onclick') || element.hasAttribute('onmousedown') || element.hasAttribute('onkeydown');
        const opacity = Number.parseFloat(style.opacity || '1');
        if (!interactive || tagName === 'input' && element.type === 'hidden' || style.display === 'none' || style.visibility === 'hidden' || opacity <= 0 || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= width) continue;
        const label = element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || undefined;
        const clipped = { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.min(rect.right, width) - Math.max(0, rect.left), height: Math.min(rect.bottom, height) - Math.max(0, rect.top) };
        if (clipped.width <= 0 || clipped.height <= 0) continue;
        const mark: VisualGuidanceMark = { id: marks.length + 1, tagName, role, label, rect: clipped, normalized: { x: clipped.x / width, y: clipped.y / height, width: clipped.width / width, height: clipped.height / height } };
        marks.push(mark);
        const box = doc.createElement('div');
        box.textContent = String(mark.id);
        box.setAttribute('data-remctrl-exclude', 'true');
        box.style.cssText = `position:fixed;left:${clipped.x}px;top:${clipped.y}px;min-width:18px;height:18px;padding:0 4px;background:#e11d48;color:white;border:1px solid white;border-radius:9px;font:700 12px/18px sans-serif;text-align:center;box-sizing:border-box;`;
        root.appendChild(box);
      }
      return { viewport: { width, height }, marks, axisGrid: { step, x, y } };
    });

    const screenshot = await page.screenshot({ type: 'jpeg', fullPage: false });
    return { screenshot, ...guidance };
  } finally {
    await page.evaluate((selector) => {
      const doc = (globalThis as any).document;
      doc.querySelectorAll(selector).forEach((element: any) => element.remove());
    }, OVERLAY_SELECTOR).catch(() => undefined);
  }
}
