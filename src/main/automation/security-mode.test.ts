import { describe, expect, it } from 'vitest';
import { isPolicyEnforced, securityModeFromEnforcement } from './security-mode.js';

describe('automation security mode', () => {
  it('maps legacy enforcement flags to explicit modes', () => {
    expect(securityModeFromEnforcement(false)).toBe('local');
    expect(securityModeFromEnforcement(true)).toBe('policy-enforced');
  });

  it('identifies policy-enforced runs', () => {
    expect(isPolicyEnforced('local')).toBe(false);
    expect(isPolicyEnforced('policy-enforced')).toBe(true);
  });
});
