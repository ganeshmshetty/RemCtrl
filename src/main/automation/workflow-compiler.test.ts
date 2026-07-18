import { describe, expect, it } from 'vitest';
import { compileWorkflow } from './workflow-compiler.js';
import type { ExecutionTraceEntry } from '../../shared/types.js';

const entry = (overrides: Partial<ExecutionTraceEntry>): ExecutionTraceEntry => ({
  id: 'trace-1', sequence: 1, timestamp: 1, tool: 'act', input: { action: 'click' },
  semanticDescription: 'Click Continue', status: 'succeeded', urlBefore: 'https://example.com/start', urlAfter: 'https://example.com/next',
  ...overrides,
});

describe('workflow compiler', () => {
  it('compiles semantic actions and deterministic postconditions', () => {
    const result = compileWorkflow([
      entry({ tool: 'goto', input: { url: 'https://example.com/start' }, semanticDescription: 'Open the sign-in page' }),
      entry({ id: 'trace-2', sequence: 2, resolvedSelector: '#continue' }),
      entry({ id: 'trace-3', sequence: 3, input: { action: 'fill', value: 'hello' }, resolvedSelector: '#query', semanticDescription: 'Enter the search query', urlBefore: 'https://example.com/next', urlAfter: 'https://example.com/next' }),
    ]);

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.steps.map((step) => step.type)).toEqual(['navigate', 'click', 'fill']);
    expect(result.steps[1].description).toBe('Click Continue');
    expect(result.steps[2].postcondition).toEqual({ kind: 'field_value', selector: '#query', value: 'hello' });
    expect(result.previewLines).toContain('Click Continue');
  });

  it('does not compile blocked or transient-selector actions', () => {
    const result = compileWorkflow([
      entry({ status: 'blocked' }),
      entry({ id: 'trace-2', resolvedSelector: '[index=14]' }),
    ]);

    expect(result.steps).toEqual([]);
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });
});
