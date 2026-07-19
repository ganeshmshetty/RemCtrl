/**
 * @file workflow-executor.ts
 * @description Coordinates and executes structured multi-step automation workflows with built-in retry mechanics, branching logic, and AI-assisted self-healing.
 * Key Exported APIs: `runWorkflow`, `cancelWorkflow`, `isWorkflowRunning`, `setWorkflowPaused`, `WorkflowRunStatusCb`, `WorkflowStepStatusCb`, and `WorkflowLogCb`.
 * Internal Mechanics: Drives the execution cycle through parsed workflow steps (`navigate`, `click`, `fill`, `select`, `keypress`, `wait`, `extract`, `check`). Checks conditional state polling, implements exponential backoff retries on failure, and handles user pause/resume takeover.
 * AI Self-Healing & Integration: If a fast-path CSS selector fails, invokes the AI tool-calling loop (`runToolLoop`) using the original step description to find the healed element, and persists the repaired selector back to the database.
 */

import type { Page } from 'playwright';
import { resolveModel } from './model-resolver.js';
import type {
  AgentWorkflowBatchPayload,
  WorkflowStep,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentLogPayload,
} from '../../shared/types.js';
import { getPreferredProvider, getApiKey, getUseVisionCUA, updateWorkflowStepSelector } from '../storage.js';
import { extractError } from '../errors.js';
import { TaskSession } from './task-session.js';
import { runToolLoop } from './agent-loop.js';
import { buildWorkflowStepSystemPrompt } from './agent-system-prompt.js';
import { acquireReadyPage } from './browser/runtime.js';
import { SemanticActionEngine } from './browser/semantic-actions.js';
import type { BrowserActionResult } from './browser/action-types.js';
import { WorkflowConditionEngine } from './workflow-conditions.js';
import {
  beginAutomationRun,
  finishAutomationRun,
  getAutomationSession,
  isAutomationRunActive,
} from './run-lifecycle.js';
import { createDevelopmentLogger } from '../dev-logger.js';
import { waitFor } from './abortable.js';

export type WorkflowRunStatusCb = (s: WorkflowRunStatus) => void;
export type WorkflowStepStatusCb = (s: WorkflowStepStatus) => void;
export type WorkflowLogCb = (l: AgentLogPayload) => void;

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;
const RETRY_BACKOFF = 2;

const WORKFLOW_MAX_TRANSITIONS = 100;
const terminalLog = createDevelopmentLogger('Dev');

function promptValue(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function isWorkflowRunning(): boolean {
  return isAutomationRunActive('workflow');
}

export function cancelWorkflow(): void {
  getAutomationSession('workflow')?.cancel();
}

export function setWorkflowPaused(paused: boolean): void {
  const session = getAutomationSession('workflow');
  if (paused) session?.pause();
  else session?.resume();
}

export async function runWorkflow(
  payload: AgentWorkflowBatchPayload,
  onRunStatus: WorkflowRunStatusCb,
  onStepStatus: WorkflowStepStatusCb,
  onLog: WorkflowLogCb,
  resumeFromStep = 0,
): Promise<void> {
  const { workflowRunId, name, steps } = payload;
  const previousRun = getAutomationSession('workflow');
  if (previousRun?.isActive) {
    emitLog(onLog, 'info', 'Terminating previous workflow run before starting new execution...', '[Workflow]');
    previousRun.cancel();
  }

  const session = new TaskSession({ commandId: workflowRunId, kind: 'workflow', workflowId: payload.workflowId, title: name });
  beginAutomationRun('workflow', session);
  session.start();
  const stopWatchdog = session.startWatchdog({
    maxDurationMs: 4 * 60 * 60 * 1000,
    inactivityMs: 15 * 60 * 1000,
    onTimeout: (error) => {
      if (session.isActive) session.fail(error);
    },
  });

  try {
    emitLog(onLog, 'info', 'Preparing browser session...', '[Workflow]');
    const localPage = await acquireReadyPage({
      launchIfMissing: true,
      onLog: (level, message) => emitLog(onLog, level, message, '[Browser]'),
    });
    const actionEngine = new SemanticActionEngine(localPage, {
      waitForNetworkIdle: false,
      navigationTimeoutMs: 20_000,
      networkIdleTimeoutMs: 10_000,
      abortSignal: session.abortSignal,
    });
    const conditions = new WorkflowConditionEngine(localPage, { abortSignal: session.abortSignal });

    const provider = getPreferredProvider();
    const requiresModel = steps.some((step) =>
      step.type === 'extract' ||
      (step.onFailure === 'self_heal' && (step.type === 'click' || step.type === 'fill' || step.type === 'select')),
    );
    if (requiresModel) {
      const apiKey = getApiKey(provider);
      if (!apiKey && provider !== 'vertex') {
        throw new Error(`Workflow requires AI recovery, but no API key is configured for provider: ${provider}`);
      }
      // Resolve configuration before changing browser state, so incompatible
      // provider/model settings fail at startup rather than midway through a run.
      resolveModel(provider, apiKey);
    }

    const initialStepIndex = Math.max(0, Math.min(resumeFromStep, steps.length));
    onRunStatus({ workflowRunId, state: 'running', currentStepIndex: initialStepIndex });
    emitLog(onLog, 'info', `Workflow "${name}" started — ${steps.length} step(s), provider="${provider}"`, '[Workflow]');

    if (initialStepIndex > 0) {
      emitLog(onLog, 'info', `Resuming near step ${initialStepIndex + 1}; the current step will be rechecked before continuing.`, '[Workflow]');
    }

    let currentStepId: string | null = steps[initialStepIndex]?.id ?? null;
    let transitions = 0;

    while (currentStepId !== null) {
      if (++transitions > WORKFLOW_MAX_TRANSITIONS) {
        throw new Error(`Workflow exceeded ${WORKFLOW_MAX_TRANSITIONS} step transitions; possible branch cycle.`);
      }

      await session.waitIfPaused(
        () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
        () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
      );

      if (session.isCancelled) {
        emitLog(onLog, 'info', 'Workflow run cancelled.', '[Workflow]');
        onRunStatus({ workflowRunId, state: 'cancelled' });
        return;
      }
      if (session.isFailed) throw session.failure ?? new Error('Workflow watchdog stopped the run.');

      const index = steps.findIndex((s) => s.id === currentStepId);
      if (index === -1) {
        throw new Error(`Step ID "${currentStepId}" not found in workflow steps.`);
      }

      const step = steps[index];
      session.touch();

      const resolvedStep = { ...step } as WorkflowStep;

      const stepLabel = `Step ${index + 1}/${steps.length} [${resolvedStep.type.toUpperCase()}]`;

      onRunStatus({ workflowRunId, state: 'running', currentStepIndex: index });
      onStepStatus({ workflowRunId, stepId: step.id, index, state: 'running' });
      session.checkpoint({ currentStep: index, completedSteps: index, currentAction: stepLabel });
      emitLog(onLog, 'info', `▶ ${stepLabel}`, '[Workflow]');

      try {
        const result = await executeStepWithRetry(localPage, actionEngine, conditions, session, resolvedStep, payload.workflowId, onLog);

        let jumpToStepId: string | null = null;
        if (resolvedStep.type === 'check') {
          const checkPassed = Boolean((result as { passed: boolean }).passed ?? result);
          onStepStatus({
            workflowRunId,
            stepId: step.id,
            index,
            state: checkPassed ? 'completed' : 'failed',
            result,
          });

          if (checkPassed) {
            jumpToStepId = resolvedStep.onTrue ?? (steps[index + 1]?.id ?? null);
          } else {
            if (resolvedStep.onFalse !== undefined && resolvedStep.onFalse !== null) {
              jumpToStepId = resolvedStep.onFalse;
            } else {
              session.fail(new Error('Check step failed and no alternative path was provided.'));
              onRunStatus({ workflowRunId, state: 'failed', error: 'Check step failed and no alternative path was provided.' });
              return;
            }
          }
        } else {
          if (resolvedStep.type === 'extract') {
            const extractResult = result as { success: boolean; message?: string };
            if (!extractResult.success) {
              throw new Error(extractResult.message || 'Extraction did not achieve its goal');
            }
          }
          onStepStatus({ workflowRunId, stepId: step.id, index, state: 'completed', result });
          session.checkpoint({ currentStep: index, completedSteps: index + 1, currentAction: stepLabel });
          jumpToStepId = steps[index + 1]?.id ?? null;
        }

        currentStepId = jumpToStepId;

      } catch (stepErr) {
        const errorInfo = extractError(stepErr);
        emitLog(onLog, 'error', `✗ ${stepLabel} failed: ${errorInfo.message}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: step.id, index, state: 'failed', error: errorInfo.message });

        if (session.isCancelled || session.isFailed) {
          throw stepErr; // Bubble up immediately to the outer catch
        }

        if (step.onFailure === 'skip') {
          emitLog(onLog, 'warn', `onFailure=skip — continuing to next step.`, '[Workflow]');
          currentStepId = steps[index + 1]?.id ?? null;
        } else {
          onRunStatus({ workflowRunId, state: 'failed', error: errorInfo.message });
          return;
        }
      }
    }

    emitLog(onLog, 'info', `Workflow "${name}" completed successfully ✓`, '[Workflow]');
    session.complete();
    onRunStatus({ workflowRunId, state: 'completed' });
  } catch (err) {
    const errorInfo = extractError(err);
    if (session.isCancelled) {
      emitLog(onLog, 'info', 'Workflow cancelled.', '[Workflow]');
      onRunStatus({ workflowRunId, state: 'cancelled' });
    } else {
      if (!session.isFailed) session.fail(new Error(errorInfo.message));
      emitLog(onLog, 'error', `Workflow failed: ${errorInfo.message}`, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'failed', error: errorInfo.message });
    }
  } finally {
    stopWatchdog();
    finishAutomationRun(session);
  }
}

async function executeStepWithRetry(
  page: Page,
  actions: SemanticActionEngine,
  conditions: WorkflowConditionEngine,
  session: TaskSession,
  step: WorkflowStep,
  workflowId: string,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  let lastError: Error | null = null;
  let attempt = 0;
  const maxAttempts =
    step.onFailure === 'retry'
      ? RETRY_MAX_ATTEMPTS
      : (step.type === 'navigate' || step.type === 'check'
          ? RETRY_MAX_ATTEMPTS
          : 1);

  while (attempt < maxAttempts) {
    attempt++;
    session.touch();
    try {
      if (attempt > 1) {
        emitLog(onLog, 'info', `Attempt ${attempt}/${maxAttempts}`, '[Workflow]');
      }
      return await executeStep(page, actions, conditions, session, step, workflowId, onLog);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorInfo = extractError(lastError);

      emitLog(onLog, 'warn', `Attempt ${attempt} failed: ${errorInfo.message}`, '[Workflow]');

      if (attempt === maxAttempts || !errorInfo.retryable) break;

      const delay = Math.min(
        RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF, attempt - 1),
        RETRY_MAX_DELAY_MS,
      );
      emitLog(onLog, 'info', `Retrying in ${delay}ms…`, '[Workflow]');
      await waitFor(delay, session.abortSignal);
    }
  }

  throw lastError ?? new Error('Unknown error after retries');
}

async function executeStep(
  page: Page,
  actions: SemanticActionEngine,
  conditions: WorkflowConditionEngine,
  session: TaskSession,
  step: WorkflowStep,
  workflowId: string,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  await session.waitIfPaused(
    () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
    () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
  );

  let result: unknown;
  switch (step.type) {
    case 'navigate': result = await executeNavigateStep(actions, session, step as any, onLog); break;
    case 'click':
    case 'fill':
    case 'select':
    case 'keypress': result = await executeDeterministicActionWithSelfHeal(actions, page, session, step as any, workflowId, onLog); break;
    case 'wait':     result = await executeWaitStep(actions, step as any, onLog); break;
    case 'extract':  result = await executeExtractStep(page, session, step as any, onLog); break;
    case 'check':    result = await executeCheckStep(conditions, session, step as any, onLog); break;
    default:
      throw new Error(`Unsupported or legacy step type: ${(step as any).type}`);
  }
  if (step.postcondition) {
    await conditions.verify(step.postcondition);
    emitLog(onLog, 'info', `Verified postcondition: ${step.postcondition.kind}`, '[Verify]');
  }
  return result;
}

async function executeDeterministicActionWithSelfHeal(
  actions: SemanticActionEngine,
  page: Page,
  session: TaskSession,
  step: Extract<WorkflowStep, { type: 'click' | 'fill' | 'select' | 'keypress' }>,
  workflowId: string,
  onLog: WorkflowLogCb
) {
  try {
    const msg = step.type === 'keypress'
      ? `Pressing key: ${step.key}`
      : `Action: ${step.type} on ${step.selector}`;
    emitLog(onLog, 'info', msg, '');
    if (session.journal) {
      await session.journal.recordAgentStep(
        step.type === 'keypress' ? 'keys' : 'act',
        step.type === 'keypress'
          ? { key: step.key }
          : { action: step.type, selector: step.selector, ...('value' in step ? { value: step.value } : {}) },
        null,
        msg,
      );
    }

    const result = step.type === 'keypress'
      ? await actions.execute({ kind: 'keys', key: step.key })
      : await actions.execute({
          kind: 'element',
          selector: step.selector,
          action: step.type,
          ...('value' in step ? { value: step.value } : {}),
          description: step.description,
        });
    return requireActionSuccess(result);
  } catch (err) {
    if (step.type === 'keypress') throw err; // Cannot self-heal a pure keypress easily
    if (step.onFailure !== 'self_heal') throw err; // Enforce onFailure policy (bypasses self-healing if stop/skip/retry)
    
    emitLog(onLog, 'warn', `Fast path failed for ${step.selector}. Triggering AI Self-Healing...`, '[SelfHeal]');
    
    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);
    const model = resolveModel(provider, apiKey);

    // Provide the original semantic description to the agent so it knows what it's looking for
    const instruction = [
      '<recovery_task>',
      `<failure_context encoding="json">${promptValue(`The saved selector ${step.selector} was not found.`)}</failure_context>`,
      `<original_intent encoding="json">${promptValue(step.description || 'Unknown')}</original_intent>`,
      `<required_action type="${step.type}">Find the matching element on the current page and perform exactly this action.</required_action>`,
      step.type === 'fill' || step.type === 'select'
        ? `<action_value encoding="json">${promptValue(step.value ?? '')}</action_value>`
        : '',
      '<success>Verify the visible effect, then call done({ taskComplete: true, message }).</success>',
      '<failure>After bounded recovery attempts, call done({ taskComplete: false, message }) with the observed blocker.</failure>',
      '</recovery_task>',
    ].filter(Boolean).join('\n');

    const loopResult = await runToolLoop({
      commandId: `self-heal-${step.id}`,
      instruction,
      systemPrompt: buildWorkflowStepSystemPrompt('do', instruction, 'local', getUseVisionCUA()), // reuse generic prompt
      page,
      session: (() => {
        return session;
      })(),
      securityMode: 'local',
      model,
      maxSteps: 5,
      onLog: (l) => emitLog(onLog, l.level, l.message, '[SelfHeal]'),
    });

    if (!loopResult.goalAchieved) {
      throw new Error(`Self-healing failed for step: ${step.description || step.selector}`, { cause: err });
    }

    // Try to extract the healed selector from the recorded steps of the self-heal agent loop
    const healActStep = [...loopResult.recordedSteps].reverse().find((s: any) => s.tool === 'act');
    const repairedSelector = healActStep?.input?.selector as string | undefined;
    if (repairedSelector) {
      emitLog(onLog, 'info', `Self-healed selector: "${repairedSelector}" (original: "${step.selector}")`, '[SelfHeal]');
      try {
        updateWorkflowStepSelector(workflowId, step.id, repairedSelector);
        emitLog(onLog, 'info', `Successfully persisted healed selector back to workflow`, '[SelfHeal]');
      } catch (saveErr) {
        emitLog(onLog, 'warn', `Failed to persist healed selector: ${(saveErr as Error).message}`, '[SelfHeal]');
      }
    }

    return { success: true, healed: true };
  }
}

async function executeNavigateStep(
  actions: SemanticActionEngine,
  session: TaskSession,
  step: Extract<WorkflowStep, { type: 'navigate' }>,
  onLog: WorkflowLogCb,
): Promise<{ navigatedTo: string; finalUrl: string; redirected: boolean }> {
  if (!step.url) throw new Error('navigate step requires a url');

  let targetUrl = step.url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  const msg = `Navigating to ${targetUrl}`;
  emitLog(onLog, 'info', msg, '');
  if (session.journal) {
    await session.journal.recordAgentStep('goto', { url: targetUrl }, null, msg);
  }
  const result = requireActionSuccess(await actions.execute({ kind: 'navigate', url: targetUrl }));
  const finalUrl = typeof result.url === 'string' ? result.url : targetUrl;
  let redirected = false;

  try {
    const target = new URL(targetUrl);
    const actual = new URL(finalUrl);
    redirected = target.hostname !== actual.hostname || target.pathname !== actual.pathname;
  } catch {
    // URL parse failure
  }

  if (redirected) {
    emitLog(onLog, 'warn', `Redirected: ${targetUrl} → ${finalUrl}. Page may be an auth wall or interstitial.`, '[Navigate]');
  } else {
    emitLog(onLog, 'info', `Arrived at: ${finalUrl}`, '[Navigate]');
  }

  return { navigatedTo: targetUrl, finalUrl, redirected };
}

async function executeExtractStep(
  page: Page,
  session: TaskSession,
  step: Extract<WorkflowStep, { type: 'extract' }>,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  if (!step.instruction) throw new Error('extract step requires an instruction');

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);
  const model = resolveModel(provider, apiKey);

  const loopResult = await runToolLoop({
    commandId: `extract-${step.id}`,
    instruction: step.instruction,
    systemPrompt: buildWorkflowStepSystemPrompt('collect', step.instruction, 'local', getUseVisionCUA()), // Reuse collect prompt logic
    page,
    session: (() => {
      return session;
    })(),
    securityMode: 'local',
    model,
    maxSteps: 15,
    onLog: (l) => emitLog(onLog, l.level, l.message, '[Extract]'),
  });

  const msg = `Extracting from page`;
  if (session.journal) {
    await session.journal.recordAgentStep('extract', { instruction: step.instruction }, loopResult.finalMessage, msg);
  }

  return {
    success: loopResult.goalAchieved,
    message: loopResult.finalMessage,
    actions: loopResult.actions,
  };
}

async function executeWaitStep(
  actions: SemanticActionEngine,
  step: Extract<WorkflowStep, { type: 'wait' }>,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  emitLog(onLog, 'info', `Waiting for ${step.ms}ms`, '[Wait]');
  return requireActionSuccess(await actions.execute({ kind: 'wait', ms: step.ms }));
}

function requireActionSuccess(result: BrowserActionResult): Extract<BrowserActionResult, { success: true }> {
  if (!result.success) throw new Error(result.reason);
  return result;
}

async function executeCheckStep(
  conditions: WorkflowConditionEngine,
  session: TaskSession,
  step: Extract<WorkflowStep, { type: 'check' }>,
  onLog: WorkflowLogCb,
): Promise<boolean> {
  if (!step.condition) throw new Error('check step requires a condition');

  const msg = `Action: check condition "${step.condition}"`;
  emitLog(onLog, 'info', msg, '');

  const matchFound = await conditions.check(step.condition);
  if (matchFound) {
    emitLog(onLog, 'info', `Condition TRUE (matched "${step.condition}").`, '[Check]');
    if (session.journal) {
      await session.journal.recordAgentStep('act', { action: 'check', selector: step.condition }, true, msg);
    }
    return true;
  }

  emitLog(onLog, 'info', 'Condition FALSE after timeout.', '[Check]');
  if (session.journal) {
    await session.journal.recordAgentStep('act', { action: 'check', selector: step.condition }, false, msg);
  }
  return false;
}

function emitLog(
  onLog: WorkflowLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[Workflow]',
): void {
  const line = prefix ? `${prefix} ${message}` : message;
  if (level === 'error') terminalLog.error(line);
  else if (level === 'warn') terminalLog.warn(line);
  else terminalLog.info(line);
  onLog({ level, message });
}
