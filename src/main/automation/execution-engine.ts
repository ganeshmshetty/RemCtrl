/**
 * @file execution-engine.ts
 * @description Orchestrates the main execution pipeline for autonomous agent runs, managing timeouts, loops, logs, and sessions.
 * Key Exported APIs: `runAgent`, `cancelAgent`, `isAgentRunning`, `setAgentPaused`, `AgentStatusCb`, and `AgentLogCb`.
 * Internal Mechanics: Acquires a ready Playwright page through the browser runtime, instantiates `TaskSession` and `ExecutionLogger`, builds multi-turn conversation contexts via `sessionHistory`, resolves LLM models dynamically, and runs the tool loop within timeout and cancellation limits.
 * Relations: Connects directly with the renderer-facing `agent.ipc.ts` for task control, triggers cursor overlay setups, and logs events through the browser status callback API.
 */

import type { Page } from 'playwright';
import { closeBrowser } from './browser-pool.js';
import { resolveModel } from './model-resolver.js';
import { ExecutionLogger } from './execution-logger.js';
import { TaskSession } from './task-session.js';
import { runToolLoop, type AgentLoopResult } from './agent-loop.js';
import { buildAgentSystemPrompt } from './agent-system-prompt.js';
import { sessionHistory } from './agent-history.js';
import { policyGate } from '../policy/policy-gate.js';
import {
  beginAutomationRun,
  finishAutomationRun,
  getAutomationSession,
  isAutomationRunActive,
  ownsAutomationRun,
} from './run-lifecycle.js';
import {
  AgentTimeoutError,
  BrowserNotReadyError,
  extractError,
} from '../errors.js';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  ApiProvider,
  WorkflowStep,
} from '../../shared/types.js';
import { acquireReadyPage } from './browser/runtime.js';
import { createDevelopmentLogger } from '../dev-logger.js';
import type { AutomationSecurityMode } from './security-mode.js';
import { waitFor } from './abortable.js';

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;
export interface AgentRunResult {
  state: 'completed' | 'failed' | 'cancelled';
  goalAchieved: boolean;
  error?: string;
}

// Browser tasks can legitimately take hours when they include approvals,
// slow sites, or a manual takeover. The watchdog protects genuinely stalled
// runs without turning ordinary model latency into a hard three-minute kill.
const COMMAND_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const COMMAND_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_STEPS = 40;
const terminalLog = createDevelopmentLogger('Dev');

export function isAgentRunning(): boolean {
  return isAutomationRunActive('agent');
}

export function cancelAgent(): void {
  const session = getAutomationSession('agent');
  if (session?.commandId) policyGate.cancelSession(session.commandId);
  session?.cancel();
}

export function setAgentPaused(paused: boolean): void {
  const session = getAutomationSession('agent');
  if (paused) session?.pause();
  else session?.resume();
}

export async function runAgent(
  commandId: string,
  _action: string,
  instruction: string,
  apiKey: string | null,
  provider: ApiProvider,
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
  onRecordStep?: (step: WorkflowStep) => void,
  securityMode: AutomationSecurityMode = 'policy-enforced',
  onCompleted?: (result: AgentLoopResult) => Promise<void>,
  sessionId = 'default',
): Promise<AgentRunResult> {
  const previousRun = getAutomationSession('agent');
  if (previousRun?.isActive) {
    log(onLog, 'info', 'Terminating previous agent run before starting new task...');
    previousRun.cancel();
  }

  const session = new TaskSession({ initialGoal: instruction, commandId, kind: 'agent', title: instruction });
  beginAutomationRun('agent', session);
  session.start();
  const stopWatchdog = session.startWatchdog({
    maxDurationMs: COMMAND_MAX_DURATION_MS,
    inactivityMs: COMMAND_INACTIVITY_TIMEOUT_MS,
    onTimeout: (error) => {
      if (session.isActive) session.fail(new AgentTimeoutError(COMMAND_INACTIVITY_TIMEOUT_MS, error.message));
    },
  });

  let initialPage: Page;
  try {
    initialPage = await acquireReadyPage({ launchIfMissing: false });
  } catch (err) {
    const browserError = err instanceof BrowserNotReadyError
      ? err
      : new BrowserNotReadyError('Launch a browser from the Host session first.');
    session.fail(browserError);
    finishAutomationRun(session);
    log(onLog, 'error', browserError.message);
    onStatus({ commandId, state: 'failed', error: browserError.message });
    return { state: 'failed', goalAchieved: false, error: browserError.message };
  }

  log(onLog, 'info', `Starting execution pipeline via provider="${provider}" security=${securityMode}`);
  terminalLog.info('run.start', {
    commandId,
    provider,
    securityMode,
    maxDurationMs: COMMAND_MAX_DURATION_MS,
    inactivityTimeoutMs: COMMAND_INACTIVITY_TIMEOUT_MS,
    maxSteps: MAX_STEPS,
  });
  onStatus({ commandId, state: 'running' });

  const executionLogger = new ExecutionLogger(commandId, instruction);

  let localPage: Page | null = null;
  try {
    localPage = initialPage;

    const guardedStatus = (payload: AgentStatusPayload) => {
      if (session.isCancelled && payload.state === 'running') return;
      session.touch();
      onStatus(payload);
    };

    const runLoop = async () => {
      const fullInstruction = sessionHistory.buildPromptContext(sessionId, instruction);
      return await runToolLoop({
        commandId,
        instruction: fullInstruction,
        systemPrompt: buildAgentSystemPrompt(instruction, securityMode),
        page: localPage!,
        session,
        model: resolveModel(provider, apiKey),
        maxSteps: MAX_STEPS,
        securityMode,
        onStatus: guardedStatus,
        onLog: (payload) => {
          session.touch();
          onLog(payload);
        },
        onRecordStep,
      });
    };

    let loopResult: AgentLoopResult;
    let retryAttempt = 0;
    while (true) {
      try {
        loopResult = await runLoop();
        break;
      } catch (loopError) {
        const errorInfo = extractError(loopError);
        const canRetry = errorInfo.retryable && !session.isCancelled && !session.isFailed && retryAttempt < 2;
        if (!canRetry) throw loopError;
        retryAttempt += 1;
        session.touch();
        const delay = Math.min(2_000 * (2 ** (retryAttempt - 1)), 10_000);
        log(onLog, 'warn', `Temporary agent failure (${errorInfo.code}). Preserving browser state and retrying in ${delay / 1000}s (${retryAttempt}/2)…`);
        await waitFor(delay, session.abortSignal);
      }
    }

    log(
      onLog,
      'info',
      `Agent loop stopped — reason=${loopResult.terminationReason}, finish=${loopResult.finishReason}, ` +
        `steps=${loopResult.stepCount}, actions=${loopResult.actions.length}, ` +
        `done=${loopResult.goalAchieved}, finalMessage=${loopResult.finalMessage ? 'present' : 'missing'}`,
    );

    if (session.isCancelled) {
      terminalLog.warn('run.cancelled', { commandId, phase: 'after_loop' });
      executionLogger.cancel();
      if (ownsAutomationRun(session)) await closeBrowser().catch(() => {});
      log(onLog, 'info', 'Pipeline cancelled.');
      onStatus({ commandId, state: 'cancelled' });
      return { state: 'cancelled', goalAchieved: false };
    } else if (!loopResult.goalAchieved && !loopResult.isConversationalResponse) {
      const error = loopResult.finalMessage || 'Agent stopped without confirming that the task was completed.';
      sessionHistory.recordTurn(sessionId, instruction, loopResult.finalMessage, loopResult.actions, commandId);
      executionLogger.fail();
      session.fail(new Error(error));
      log(
        onLog,
        'warn',
        `Pipeline incomplete — ${error} ` +
          `[termination=${loopResult.terminationReason}, finish=${loopResult.finishReason}, ` +
          `steps=${loopResult.stepCount}, done=${loopResult.goalAchieved}]`,
      );
      onStatus({ commandId, state: 'failed', error, result: { ...loopResult, originalInstruction: instruction } });
      return { state: 'failed', goalAchieved: false, error };
    } else {
      sessionHistory.recordTurn(sessionId, instruction, loopResult.finalMessage, loopResult.actions, commandId);
      await sessionHistory.maybeCompactHistory(sessionId, resolveModel(provider, apiKey)).catch(() => {});
      // Recording persistence happens before the terminal success event so a
      // workflow is never shown as successfully created when saving failed.
      if (loopResult.goalAchieved) await onCompleted?.(loopResult);
      executionLogger.complete();
      const summary = executionLogger.getSummary() as Record<string, any>;
      summary.totalSteps = loopResult.stepCount;
      summary.successfulSteps = loopResult.stepCount;
      summary.actions = loopResult.actions;
      summary.finishReason = loopResult.finishReason;
      summary.goalAchieved = loopResult.goalAchieved;
      summary.isConversationalResponse = loopResult.isConversationalResponse;
      summary.recordedSteps = loopResult.recordedSteps;
      summary.executionTrace = loopResult.executionTrace;
      summary.originalInstruction = instruction;
      if (loopResult.finalMessage) {
        summary.finalMessage = loopResult.finalMessage;
      }

      session.complete();

      log(
        onLog,
        'info',
        `Pipeline complete — ${loopResult.stepCount} tool calls, goal=${loopResult.goalAchieved}, ` +
          `duration=${(summary.totalDuration / 1000).toFixed(1)}s`,
      );
      onStatus({ commandId, state: 'completed', result: summary });
      return { state: 'completed', goalAchieved: true };
    }
  } catch (err) {
    executionLogger.fail();
    if (ownsAutomationRun(session)) await closeBrowser().catch(() => {});
    const errInfo = extractError(err);
    const recoveryMessage = describeProviderFailure(errInfo.message, provider);
    terminalLog.error('run.error', {
      commandId,
      provider,
      cancelled: session.isCancelled,
      errorType: err instanceof Error ? err.name : typeof err,
      message: recoveryMessage,
    });

    if (session.isCancelled) {
      terminalLog.warn('run.cancelled', { commandId, phase: 'error_handler' });
      log(onLog, 'info', 'Pipeline cancelled.');
      onStatus({ commandId, state: 'cancelled' });
      return { state: 'cancelled', goalAchieved: false };
    } else {
      if (!session.isFailed) session.fail(new Error(recoveryMessage));
      log(onLog, 'error', `Pipeline failed: ${recoveryMessage}`);
      onStatus({ commandId, state: 'failed', error: recoveryMessage });
      return { state: 'failed', goalAchieved: false, error: recoveryMessage };
    }
  } finally {
    policyGate.cancelSession(commandId);
    stopWatchdog();
    // A newer run may have replaced this session while this one was winding
    // down. Never clear the newer run's lifecycle reference.
    finishAutomationRun(session);
    localPage = null;
  }
}

function describeProviderFailure(message: string, provider: ApiProvider): string {
  if (/resource has been exhausted|quota/i.test(message)) {
    return `${provider === 'vertex' ? 'Vertex AI' : provider} quota is exhausted. Wait for quota to reset, increase the provider quota, or select another configured provider.`;
  }
  if (/unsupported model version v3/i.test(message)) {
    return provider === 'gemini'
      ? 'The selected Gemini model requires an unsupported provider protocol. Select a Gemini 2.5 model; stale Gemini 3 selections are automatically downgraded for the Gemini provider.'
      : message;
  }
  return message;
}

function log(
  onLog: AgentLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[ExecutionEngine]',
): void {
  const line = `${prefix} ${message}`;
  if (level === 'error') terminalLog.error(line);
  else if (level === 'warn') terminalLog.warn(line);
  else terminalLog.info(line);
  onLog({ level, message });
}
