import type { ApiProvider } from '../../shared/types.js';
import type { AutomationSecurityMode } from '../automation/security-mode.js';

export type AgentPreflightMode = 'start' | 'rewind';

export interface AgentPreflightRequest {
  mode: AgentPreflightMode;
  executionMode?: 'local' | 'remote';
  instruction?: string;
}

export interface AgentPreflightDependencies {
  isWorkflowRunning: () => boolean;
  isAgentRunning: () => boolean;
  isTrustedHost: () => boolean;
  getTaskScope: () => Record<string, unknown> | null;
  setTaskScope: (scope: Record<string, unknown>) => void;
  saveTaskScope: (scope: Record<string, unknown>) => void;
  getPreferredProvider: () => ApiProvider;
  getApiKey: (provider: ApiProvider) => string | null;
}

export interface AgentPreflightSuccess {
  ok: true;
  provider: ApiProvider;
  apiKey: string | null;
  enforceScope: boolean;
  securityMode: AutomationSecurityMode;
}

export interface AgentPreflightFailure {
  ok: false;
  error: string;
}

export type AgentPreflightResult = AgentPreflightSuccess | AgentPreflightFailure;

/**
 * Shared admission and configuration seam for agent IPC entry points. It keeps
 * start and rewind behavior aligned while leaving the actual run orchestration
 * in execution-engine.ts.
 */
export function prepareAgentRun(
  request: AgentPreflightRequest,
  deps: AgentPreflightDependencies,
): AgentPreflightResult {
  if (deps.isWorkflowRunning()) return { ok: false, error: 'A workflow is already running.' };
  if (deps.isAgentRunning()) return { ok: false, error: 'An agent command is already running.' };

  const enforceScope = request.executionMode !== 'local' && !deps.isTrustedHost();
  if (enforceScope) {
    const taskScope = deps.getTaskScope();
    if (request.mode === 'start') {
      if (!taskScope || !('goal' in taskScope)) {
        return { ok: false, error: 'Task scope is unavailable. Reopen the app and try again.' };
      }
      if (typeof taskScope.goal !== 'string' || !taskScope.goal.trim()) {
        const scopedTask = { ...taskScope, goal: request.instruction?.trim() ?? '' };
        deps.setTaskScope(scopedTask);
        deps.saveTaskScope(scopedTask);
      }
    } else if (!taskScope || typeof taskScope.goal !== 'string' || !taskScope.goal.trim()) {
      return { ok: false, error: 'Describe the task goal and save the task scope before rerunning the agent.' };
    }
  }

  const provider = deps.getPreferredProvider();
  const apiKey = deps.getApiKey(provider);
  if (!apiKey && provider !== 'vertex') {
    return { ok: false, error: `No API key set for provider: ${provider}` };
  }

  return {
    ok: true,
    provider,
    apiKey,
    enforceScope,
    securityMode: enforceScope ? 'policy-enforced' : 'local',
  };
}
