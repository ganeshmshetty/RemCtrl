import { describe, expect, it, vi } from 'vitest';
import { captureVisualGuidance } from './visual-guidance.js';

class FakeElement {
  nodeType = 1;
  children: FakeElement[] = [];
  childNodes = this.children;
  parentNode: FakeElement | null = null;
  shadowRoot: FakeElement | null = null;
  attributes = new Map<string, string>();
  style: Record<string, string> & { cssText?: string } = { display: 'block', visibility: 'visible', opacity: '1', cursor: 'default' };
  rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  textContent = '';
  type = '';
  tabIndex = -1;
  isContentEditable = false;
  id = '';
  tagName: string;

  constructor(tagName: string, rect = { left: 0, top: 0, width: 0, height: 0 }, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.setRect(rect);
  }

  setRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.rect = { ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height };
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode.childNodes = this.parentNode.children;
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  getBoundingClientRect(): typeof this.rect { return this.rect; }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current) {
      if (selector === '[data-remctrl-exclude]' && current.hasAttribute('data-remctrl-exclude')) return current;
      current = current.parentNode;
    }
    return null;
  }
}

class FakeDocument {
  documentElement = new FakeElement('html');
  body = new FakeElement('body');

  constructor() { this.documentElement.appendChild(this.body); }

  createElement(tagName: string): FakeElement { return new FakeElement(tagName); }
  createElementNS(_namespace: string, tagName: string): FakeElement { return new FakeElement(tagName); }

  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        const matches = selector === '*' || selector === '#remctrl-overlay-root' && child.id === 'remctrl-overlay-root';
        if (matches) result.push(child);
        visit(child);
        if (child.shadowRoot) visit(child.shadowRoot);
      }
    };
    visit(this.documentElement);
    return result;
  }
}

function element(tagName: string, rect: { left: number; top: number; width: number; height: number }, text = ''): FakeElement {
  return new FakeElement(tagName, rect, text);
}

function browserFixture(): { document: FakeDocument; window: { innerWidth: number; innerHeight: number; getComputedStyle: (node: FakeElement) => Record<string, string> } } {
  const document = new FakeDocument();
  const button = element('button', { left: 120, top: 80, width: 100, height: 40 }, 'Save');
  const shadowHost = element('custom-button', { left: 400, top: 80, width: 100, height: 40 });
  shadowHost.shadowRoot = new FakeElement('#shadow-root');
  shadowHost.shadowRoot.appendChild(element('button', { left: 400, top: 80, width: 100, height: 40 }, 'Shadow save'));
  const wrapper = element('label', { left: 120, top: 180, width: 180, height: 32 }, 'Name');
  wrapper.appendChild(element('input', { left: 130, top: 185, width: 160, height: 22 }));
  const editable = element('div', { left: 120, top: 240, width: 160, height: 32 });
  editable.isContentEditable = true;
  const mouseHandler = element('div', { left: 120, top: 290, width: 160, height: 32 });
  mouseHandler.setAttribute('onmousedown', 'handle()');
  const keyHandler = element('div', { left: 120, top: 340, width: 160, height: 32 });
  keyHandler.setAttribute('onkeydown', 'handle()');
  const partial = element('button', { left: -20, top: 400, width: 100, height: 40 }, 'Partial');
  const invisible = element('button', { left: 120, top: 460, width: 100, height: 40 }, 'Invisible');
  invisible.style.opacity = '0';
  const oldRoot = element('div', { left: 0, top: 0, width: 1200, height: 800 });
  oldRoot.id = 'remctrl-overlay-root';
  oldRoot.setAttribute('id', 'remctrl-overlay-root');
  oldRoot.appendChild(element('button', { left: 10, top: 10, width: 50, height: 20 }, 'Old overlay button'));
  document.body.appendChild(oldRoot);
  document.body.appendChild(button);
  document.body.appendChild(shadowHost);
  document.body.appendChild(wrapper);
  document.body.appendChild(editable);
  document.body.appendChild(mouseHandler);
  document.body.appendChild(keyHandler);
  document.body.appendChild(partial);
  document.body.appendChild(invisible);

  return { document, window: { innerWidth: 1200, innerHeight: 800, getComputedStyle: (node) => node.style } };
}

function mockPage(fixture: ReturnType<typeof browserFixture>, screenshot: () => Promise<Buffer> = async () => Buffer.from('jpeg')) {
  const evaluate = vi.fn(async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
    const runtime = globalThis as Record<string, unknown>;
    const previousDocument = runtime.document;
    const previousWindow = runtime.window;
    runtime.document = fixture.document;
    runtime.window = fixture.window;
    try { return await fn(arg); }
    finally {
      runtime.document = previousDocument;
      runtime.window = previousWindow;
    }
  });
  return { evaluate, screenshot: vi.fn(screenshot) } as any;
}

describe('captureVisualGuidance', () => {
  it('executes overlay logic, discovers shadow/wrapper/handler/editable targets, clips, and self-excludes', async () => {
    const fixture = browserFixture();
    const page = mockPage(fixture, async () => {
      expect(fixture.document.querySelectorAll('#remctrl-overlay-root')).toHaveLength(1);
      return Buffer.from('jpeg');
    });
    const result = await captureVisualGuidance(page);

    expect(fixture.document.querySelectorAll('#remctrl-overlay-root')).toHaveLength(0);
    expect(result.viewport).toEqual({ width: 1200, height: 800 });
    expect(result.marks.map((mark) => mark.label)).toEqual(expect.arrayContaining(['Save', 'Shadow save', 'Name', 'Partial']));
    expect(result.marks.map((mark) => mark.label)).not.toContain('Old overlay button');
    expect(result.marks.some((mark) => mark.tagName === 'div')).toBe(true);
    expect(result.marks.find((mark) => mark.label === 'Invisible')).toBeUndefined();
    const partial = result.marks.find((mark) => mark.label === 'Partial');
    expect(partial?.rect).toMatchObject({ x: 0, width: 80 });
    expect(partial?.normalized).toMatchObject({ x: 0, width: 1 / 15 });
    expect(result.axisGrid.x).toHaveLength(11);
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', fullPage: false });
  });

  it('removes old and new roots in finally when screenshot fails', async () => {
    const fixture = browserFixture();
    const page = mockPage(fixture, async () => { throw new Error('capture failed'); });

    await expect(captureVisualGuidance(page)).rejects.toThrow('capture failed');
    expect(fixture.document.querySelectorAll('#remctrl-overlay-root')).toHaveLength(0);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});
