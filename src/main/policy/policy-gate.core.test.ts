import { describe, expect, it } from 'vitest';
import { InMemoryPolicyGate } from './policy-gate.js';

const baseScope = {
  id: 'scope-1',
  capabilities: { allow: ['browser.*'], deny: [] },
  origins: { allow: ['https://example.com'], deny: [] },
  domains: { allow: [], deny: [] },
  paths: { allow: ['/safe/*'], deny: [] },
  requireApproval: [],
  limits: { maxPendingApprovals: 4, approvalTtlMs: 5_000, maxAuditEvents: 20 },
};

const intent = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'session-1',
  actorId: 'actor-1',
  action: 'navigate',
  capability: 'browser.navigate',
  url: 'https://EXAMPLE.com/safe/item?secret=redacted',
  payload: { secret: 'never audited' },
  ...overrides,
});

describe('InMemoryPolicyGate', () => {
  it('normalizes HTTP(S) resources and gives deny rules precedence', () => {
    const gate = new InMemoryPolicyGate();
    gate.setScope({ ...baseScope, capabilities: { allow: ['browser.*'], deny: ['browser.navigate'] } });

    const result = gate.authorize(intent());

    expect(result.status).toBe('denied');
    expect(result.reasonCodes).toContain('capability_denied');
    expect(result.auditEvent.resource).toEqual({
      origin: 'https://example.com',
      domain: 'example.com',
      path: '/safe/item',
    });
    expect(result.auditEvent.resource?.path).not.toContain('secret');
  });

  it('binds approval use to the action digest and consumes it once', () => {
    const gate = new InMemoryPolicyGate();
    gate.setScope({ ...baseScope, requireApproval: ['browser.navigate'] });

    const pending = gate.authorize(intent());
    expect(pending.status).toBe('pending');
    const approval = pending.approval;
    expect(approval).toBeDefined();

    expect(gate.resolveApproval(approval!.id, 'approve')?.status).toBe('approved');
    const allowed = gate.authorize(intent({ approvalId: approval!.id }));
    expect(allowed.status).toBe('allowed');

    const replay = gate.authorize(intent({ approvalId: approval!.id }));
    expect(replay.status).toBe('denied');
    expect(replay.reasonCodes).toContain('invalid_approval');
  });
});
