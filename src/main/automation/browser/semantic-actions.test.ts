import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { SemanticActionEngine } from './semantic-actions.js';

function pageStub(): Page {
  return { url: () => 'https://example.test/' } as unknown as Page;
}

describe('SemanticActionEngine', () => {
  it('executes local companion waits without a guard', async () => {
    const engine = new SemanticActionEngine(pageStub());

    await expect(engine.execute({ kind: 'wait', ms: 0 })).resolves.toEqual({ success: true });
  });

  it('returns an optional guard decision before navigation', async () => {
    const engine = new SemanticActionEngine(pageStub(), {
      guard: async () => ({
        success: false,
        blockedByPolicy: true,
        code: 'blocked' as const,
        reason: 'Navigation requires approval.',
      }),
    });

    await expect(engine.execute({ kind: 'navigate', url: 'https://blocked.test' })).resolves.toMatchObject({
      success: false,
      blockedByPolicy: true,
      reason: 'Navigation requires approval.',
    });
  });
});
