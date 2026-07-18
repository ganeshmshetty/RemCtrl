import { describe, expect, it } from 'vitest';
import { formatToolAction } from './agent-trace.js';

describe('formatToolAction', () => {
  it('prefers semantic descriptions for element actions', () => {
    expect(formatToolAction('act', { action: 'click', description: 'Click Save' }))
      .toBe('Click Save');
  });

  it('formats sequence and unknown tool events consistently', () => {
    expect(formatToolAction('runActionSequence', { actions: [{}, {}] }))
      .toBe('Executing sequence of 2 actions');
    expect(formatToolAction('custom', {})).toBe('Running custom');
  });

  it('handles malformed tool input without throwing', () => {
    expect(formatToolAction('goto', null)).toBe('Navigating to page');
    expect(formatToolAction('scroll', { direction: 'down' })).toBe('Scrolling down 500px');
  });
});
