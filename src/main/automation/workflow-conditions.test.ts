import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { WorkflowConditionEngine } from './workflow-conditions.js';

function pageStub(overrides: Partial<Page> = {}): Page {
  return {
    url: () => 'https://example.test/checkout',
    locator: () => ({
      first: () => ({
        isVisible: async () => true,
        inputValue: async () => 'ready',
      }),
    }),
    getByText: () => ({ first: () => ({ isVisible: async () => true }) }),
    evaluate: async () => true,
    ...overrides,
  } as unknown as Page;
}

describe('WorkflowConditionEngine', () => {
  it('verifies URL and selector postconditions behind one interface', async () => {
    const engine = new WorkflowConditionEngine(pageStub(), { timeoutMs: 0 });

    await expect(engine.verify({ kind: 'url_includes', value: '/checkout' })).resolves.toBeUndefined();
    await expect(engine.verify({ kind: 'selector_visible', value: '#ready' })).resolves.toBeUndefined();
  });

  it('polls page checks and returns false after the configured timeout', async () => {
    const engine = new WorkflowConditionEngine(pageStub({ evaluate: async () => false }), {
      timeoutMs: 0,
      sleep: async () => {},
    });

    await expect(engine.check('missing')).resolves.toBe(false);
  });

  it('reports the postcondition kind when verification fails', async () => {
    const engine = new WorkflowConditionEngine(pageStub({ url: () => 'https://example.test/home' }), {
      timeoutMs: 0,
    });

    await expect(engine.verify({ kind: 'url_includes', value: '/checkout' }))
      .rejects.toThrow('Postcondition failed: url_includes');
  });
});
