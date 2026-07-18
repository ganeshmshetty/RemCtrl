import { describe, expect, it } from 'vitest';
import { PolicyGate } from './policy-gate.js';
import type { ActionIntent } from '../../shared/types.js';

const intent = (overrides: Partial<ActionIntent> = {}): ActionIntent => ({
  sessionId: 'session-1',
  source: 'agent' as const,
  actorId: 'agent-1',
  capability: 'browser.navigate' as const,
  url: 'https://allowed.example/path',
  summary: 'Navigate to allowed.example',
  ...overrides,
});

describe('PolicyGate', () => {
  it('blocks a navigation outside the declared domains before execution', async () => {
    const gate = new PolicyGate();
    gate.setScope({ id: 'scope', name: 'Scoped task', goal: 'Read an article on the allowed site.', allowedDomains: ['allowed.example'], requireApprovalFor: [], maxActions: 2 });

    await expect(gate.authorize(intent({ url: 'https://blocked.example' }))).resolves.toMatchObject({
      decision: 'blocked',
      reason: expect.any(String),
    });
  });

  it('waits for a single host approval before allowing a protected action', async () => {
    const gate = new PolicyGate();
    gate.setScope({ id: 'scope', name: 'Scoped task', goal: 'Update the account profile.', allowedDomains: ['allowed.example'], requireApprovalFor: ['browser.click'], maxActions: 2 });
    let approvalId = '';
    gate.subscribe((event) => {
      if ('approval' in event) approvalId = event.approval.id;
    });

    const result = gate.authorize(intent({ capability: 'browser.click', summary: 'Save account profile' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approvalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(gate.resolveApproval(approvalId, true)).toMatchObject({ decision: 'approved' });
    await expect(result).resolves.toMatchObject({ decision: 'approved' });
    expect(gate.resolveApproval(approvalId, true)).toMatchObject({ decision: 'blocked' });
  });

  it('allows low-risk, in-scope research navigation without waiting for approval', async () => {
    const gate = new PolicyGate();
    gate.setScope({
      id: 'scope', name: 'Research task', goal: 'Find and read the latest product documentation.',
      allowedDomains: ['allowed.example'], requireApprovalFor: ['browser.navigate'], maxActions: 5,
    });

    await expect(gate.authorize(intent())).resolves.toMatchObject({ decision: 'allowed' });
  });

  it('allows in-scope navigation for a non-research action goal', async () => {
    const gate = new PolicyGate();
    gate.setScope({
      id: 'scope', name: 'Open a site', goal: 'Open YouTube.',
      allowedDomains: ['youtube.com', '*.youtube.com'], requireApprovalFor: ['browser.navigate'], maxActions: 5,
    });

    await expect(gate.authorize(intent({ url: 'https://www.youtube.com/' }))).resolves.toMatchObject({ decision: 'allowed' });
  });

  it('requires a declared goal before it authorizes an action', async () => {
    const gate = new PolicyGate();
    gate.setScope({ id: 'scope', name: 'Incomplete task', goal: '', allowedDomains: ['allowed.example'], requireApprovalFor: [], maxActions: 2 });

    await expect(gate.authorize(intent())).resolves.toMatchObject({
      decision: 'blocked',
      reason: expect.stringContaining('Declare the task goal'),
    });
  });
});
