import { describe, expect, it, vi } from 'vitest';
import { captureVisualGuidance } from './visual-guidance.js';

function mockPage(options: { screenshot?: () => Promise<Buffer> } = {}) {
  const evaluate = vi.fn(async (_fn: unknown, arg?: unknown) => {
    if (arg) return undefined;
    return {
      viewport: { width: 1200, height: 800 },
      marks: [{ id: 1, tagName: 'button', label: 'Save', rect: { x: 120, y: 80, width: 100, height: 40 }, normalized: { x: 0.1, y: 0.1, width: 1 / 12, height: 0.05 } }],
      axisGrid: { step: 0.1, x: Array.from({ length: 11 }, (_, i) => i / 10), y: Array.from({ length: 11 }, (_, i) => i / 10) },
    };
  });
  return { evaluate, screenshot: vi.fn(options.screenshot ?? (async () => Buffer.from('jpeg'))) } as any;
}

describe('captureVisualGuidance', () => {
  it('injects an excluded, pointer-transparent guide and returns typed metadata', async () => {
    const page = mockPage();
    const result = await captureVisualGuidance(page);

    expect(result.screenshot).toEqual(Buffer.from('jpeg'));
    expect(result.viewport).toEqual({ width: 1200, height: 800 });
    expect(result.marks[0]).toMatchObject({ id: 1, label: 'Save', normalized: { x: 0.1, y: 0.1 } });
    expect(result.axisGrid.step).toBe(0.1);
    expect(String(page.evaluate.mock.calls[0][0])).toContain('remctrl-overlay-root');
    expect(String(page.evaluate.mock.calls[0][0])).toContain('data-remctrl-exclude');
    expect(String(page.evaluate.mock.calls[0][0])).toContain('pointer-events:none');
    expect(page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', fullPage: false });
  });

  it('cleans up in finally when screenshot fails', async () => {
    const page = mockPage({ screenshot: async () => { throw new Error('capture failed'); } });

    await expect(captureVisualGuidance(page)).rejects.toThrow('capture failed');
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(String(page.evaluate.mock.calls[1][0])).toContain('querySelectorAll');
    expect(page.evaluate.mock.calls[1][1]).toBe('#remctrl-overlay-root[data-remctrl-exclude="true"]');
  });
});
