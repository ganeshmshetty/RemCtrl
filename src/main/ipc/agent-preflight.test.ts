import { describe, expect, it, vi } from 'vitest';
import { prepareAgentRun, type AgentPreflightDependencies } from './agent-preflight.js';

function deps(overrides: Partial<AgentPreflightDependencies> = {}): AgentPreflightDependencies {
  return {
    isWorkflowRunning: () => false,
    isAgentRunning: () => false,
    isTrustedHost: () => true,
    getTaskScope: () => null,
    setTaskScope: vi.fn(),
    saveTaskScope: vi.fn(),
    getPreferredProvider: () => 'openai',
    getApiKey: () => 'test-key',
    ...overrides,
  };
}

describe('prepareAgentRun', () => {
  it('shares provider and active-run validation for a local run', () => {
    expect(prepareAgentRun({ mode: 'start', executionMode: 'local' }, deps()))
      .toEqual({ ok: true, provider: 'openai', apiKey: 'test-key', enforceScope: false, securityMode: 'local' });
    expect(prepareAgentRun({ mode: 'start' }, deps({ isWorkflowRunning: () => true })))
      .toEqual({ ok: false, error: 'A workflow is already running.' });
  });

  it('initializes a missing scoped goal only for a new remote run', () => {
    const setTaskScope = vi.fn();
    const saveTaskScope = vi.fn();
    const result = prepareAgentRun(
      { mode: 'start', executionMode: 'remote', instruction: 'Book a flight' },
      deps({ isTrustedHost: () => false, getTaskScope: () => ({ id: 'scope', goal: '' }), setTaskScope, saveTaskScope }),
    );

    expect(result).toMatchObject({ ok: true, enforceScope: true, securityMode: 'policy-enforced' });
    expect(setTaskScope).toHaveBeenCalledWith({ id: 'scope', goal: 'Book a flight' });
    expect(saveTaskScope).toHaveBeenCalledWith({ id: 'scope', goal: 'Book a flight' });
  });

  it('requires an existing goal when rewinding a remote run', () => {
    expect(prepareAgentRun({ mode: 'rewind', executionMode: 'remote' }, deps({ isTrustedHost: () => false })))
      .toEqual({ ok: false, error: 'Describe the task goal and save the task scope before rerunning the agent.' });
  });
});
