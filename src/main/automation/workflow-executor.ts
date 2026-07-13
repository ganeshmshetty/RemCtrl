/**
 * Workflow Executor — Smart Workflow Architecture
 *
 * Step types: navigate | do | collect | check
 *
 * Execution is jump-based (not a flat index loop) so that `check` steps can
 * branch to arbitrary step IDs via onTrue / onFalse.
 *
 * Per-step failure policy:
 *   onFailure: 'stop'  → abort the whole workflow (default)
 *   onFailure: 'skip'  → log the error, advance to the next step linearly
 */

import { getBrowserPage } from './browser-pool.js';
import type { Page } from 'playwright';
import { resolveModel } from './model-resolver.js';
import { ensureCursorOverlay } from './cursor-overlay.js';
import type {
  AgentWorkflowBatchPayload,
  WorkflowStep,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentLogPayload,
} from '../../shared/types.js';
import { getPage, getCdpUrl, launchBrowser } from '../browser-manager.js';
import { getPreferredProvider, getApiKey } from '../storage.js';
import {
  BrowserNotReadyError,
  extractError,
} from '../errors.js';
import { TaskSession } from './task-session.js';
import { runToolLoop } from './agent-loop.js';
import { buildWorkflowStepSystemPrompt } from './agent-system-prompt.js';

export type WorkflowRunStatusCb = (s: WorkflowRunStatus) => void;
export type WorkflowStepStatusCb = (s: WorkflowStepStatus) => void;
export type WorkflowLogCb = (l: AgentLogPayload) => void;

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;
const RETRY_BACKOFF = 2;

const DO_MAX_STEPS = 8;
const COLLECT_MAX_PAGES = 10;
const CHECK_POLL_INTERVAL_MS = 500;
const CHECK_POLL_MAX_MS = 3_000;
const WORKFLOW_MAX_TRANSITIONS = 100;

/**
 * Replace {{variable_name}} placeholders in a string with values from the variables map.
 * Unresolved placeholders are left as-is so steps still show their template form in logs.
 */
function substituteVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    return Object.prototype.hasOwnProperty.call(variables, trimmed) ? variables[trimmed] : match;
  });
}

function substituteUrlVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    if (!Object.prototype.hasOwnProperty.call(variables, trimmed)) return match;
    const value = variables[trimmed];
    // Don't encode if the variable contains a full domain/URL
    if (/^https?:\/\//i.test(value)) return value;
    return encodeURIComponent(value);
  });
}

let activeSession: TaskSession | null = null;

export function isWorkflowRunning(): boolean {
  return activeSession?.isActive ?? false;
}

export function cancelWorkflow(): void {
  activeSession?.cancel();
}

export function setWorkflowPaused(paused: boolean): void {
  if (paused) activeSession?.pause();
  else activeSession?.resume();
}

export async function runWorkflow(
  payload: AgentWorkflowBatchPayload,
  onRunStatus: WorkflowRunStatusCb,
  onStepStatus: WorkflowStepStatusCb,
  onLog: WorkflowLogCb,
): Promise<void> {
  const { workflowRunId, name, startUrl, steps } = payload;
  if (activeSession?.isActive) {
    emitLog(onLog, 'info', 'Terminating previous workflow run before starting new execution...', '[Workflow]');
    activeSession.cancel();
  }

  const session = new TaskSession();
  activeSession = session;
  session.start();

  let localPage: Page | null = null;

  try {
    let page = getPage();
    let cdpUrl = getCdpUrl();

    if (!page || !cdpUrl) {
      emitLog(onLog, 'info', 'Launching local browser...', '[Workflow]');
      await launchBrowser();
      page = getPage();
      cdpUrl = getCdpUrl();
    }

    if (!page || !cdpUrl) {
      throw new BrowserNotReadyError('Browser failed to initialize.');
    }

    const provider = getPreferredProvider();

    onRunStatus({ workflowRunId, state: 'running', currentStepIndex: 0 });
    emitLog(onLog, 'info', `Workflow "${name}" started — ${steps.length} step(s), provider="${provider}"`, '[Workflow]');

    localPage = getPage();
    if (!localPage) {
      emitLog(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`, '[Workflow]');
      localPage = await getBrowserPage(cdpUrl, (level, msg) => {
        emitLog(onLog, level, msg, '[Browser]');
      });
    }

    if (startUrl) {
      let targetUrl = startUrl.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }
      emitLog(onLog, 'info', `Navigating to start URL: ${targetUrl}`, '[Workflow]');
      await localPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch((e: Error) => {
        emitLog(onLog, 'warn', `Start URL navigation warning: ${e.message}`, '[Workflow]');
      });
    }

    let currentStepId: string | null = steps[0]?.id ?? null;
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

      const index = steps.findIndex((s) => s.id === currentStepId);
      if (index === -1) {
        throw new Error(`Step ID "${currentStepId}" not found in workflow steps.`);
      }

      const step = steps[index];

      // Apply {{variable}} substitution for parameterized replay
      payload.variables = payload.variables ?? {};
      const vars = payload.variables;
      const resolvedStep: WorkflowStep = {
        ...step,
        url: step.url ? substituteUrlVariables(step.url, vars) : step.url,
        instruction: step.instruction ? substituteVariables(step.instruction, vars) : step.instruction,
      };

      const stepLabel = `Step ${index + 1}/${steps.length} [${resolvedStep.type.toUpperCase()}]`;

      onRunStatus({ workflowRunId, state: 'running', currentStepIndex: index });
      onStepStatus({ workflowRunId, stepId: step.id, index, state: 'running' });
      emitLog(onLog, 'info', `▶ ${stepLabel}`, '[Workflow]');

      try {
        const result = await executeStepWithRetry(localPage, resolvedStep, onLog);

        let jumpToStepId: string | null = null;
        if (resolvedStep.type === 'check') {
          const checkPassed = Boolean((result as { passed: boolean }).passed);
          onStepStatus({
            workflowRunId,
            stepId: step.id,
            index,
            state: checkPassed ? 'completed' : 'failed',
            result,
          });

          if (checkPassed) {
            jumpToStepId = step.onTrue ?? (steps[index + 1]?.id ?? null);
          } else {
            jumpToStepId = step.onFalse ?? null;
          }
        } else {
          onStepStatus({ workflowRunId, stepId: step.id, index, state: 'completed', result });
          if (resolvedStep.type === 'collect') {
            vars[`step_${index + 1}_output`] = String((result as any).message || '');
          }
          jumpToStepId = steps[index + 1]?.id ?? null;
        }

        currentStepId = jumpToStepId;

      } catch (stepErr) {
        const errorInfo = extractError(stepErr);
        emitLog(onLog, 'error', `✗ ${stepLabel} failed: ${errorInfo.message}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: step.id, index, state: 'failed', error: errorInfo.message });

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
    onRunStatus({ workflowRunId, state: 'completed' });
  } catch (err) {
    const errorInfo = extractError(err);
    if (session.isCancelled) {
      emitLog(onLog, 'info', 'Workflow cancelled.', '[Workflow]');
      onRunStatus({ workflowRunId, state: 'cancelled' });
    } else {
      emitLog(onLog, 'error', `Workflow failed: ${errorInfo.message}`, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'failed', error: errorInfo.message });
    }
  } finally {
    if (activeSession === session) {
      activeSession = null;
    }
    localPage = null;
  }
}

async function executeStepWithRetry(
  page: Page,
  step: WorkflowStep,
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
    try {
      if (attempt > 1) {
        emitLog(onLog, 'info', `Attempt ${attempt}/${maxAttempts}`, '[Workflow]');
      }
      return await executeStep(page, step, onLog);
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
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Unknown error after retries');
}

async function executeStep(
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  await ensureCursorOverlay(page);
  await activeSession?.waitIfPaused(
    () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
    () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
  );

  switch (step.type) {
    case 'navigate': return executeNavigateStep(page, step, onLog);
    case 'do':       return executeDoStep(page, step, onLog);
    case 'collect':  return executeCollectStep(page, step, onLog);
    case 'check':    return executeCheckStep(page, step, onLog);
    default: {
      const _exhaustive: never = step.type;
      throw new Error(`Unknown step type: ${_exhaustive}`);
    }
  }
}

async function executeNavigateStep(
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<{ navigatedTo: string; finalUrl: string; redirected: boolean }> {
  if (!step.url) throw new Error('navigate step requires a url');

  let targetUrl = step.url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  emitLog(onLog, 'info', `Navigating to: ${targetUrl}`, '[Navigate]');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await ensureCursorOverlay(page);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  const finalUrl = page.url();
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

async function executeDoStep(
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  if (!step.instruction) throw new Error('do step requires an instruction');

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);
  const model = resolveModel(provider, apiKey);

  const loopResult = await runToolLoop({
    commandId: `workflow-do-${step.id}`,
    instruction: step.instruction,
    systemPrompt: buildWorkflowStepSystemPrompt('do', step.instruction),
    page,
    session: activeSession!,
    model,
    maxSteps: DO_MAX_STEPS * 2,
    onLog: (l) => emitLog(onLog, l.level, l.message, '[Do]'),
  });

  if (!loopResult.goalAchieved) {
    throw new Error(`Do step did not complete: "${step.instruction}"`);
  }
  return {
    success: true,
    message: loopResult.finalMessage,
    actions: loopResult.actions,
  };
}

async function executeCollectStep(
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  if (!step.instruction) throw new Error('collect step requires an instruction');

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);
  const model = resolveModel(provider, apiKey);

  const loopResult = await runToolLoop({
    commandId: `workflow-collect-${step.id}`,
    instruction: step.instruction,
    systemPrompt: buildWorkflowStepSystemPrompt('collect', step.instruction),
    page,
    session: activeSession!,
    model,
    maxSteps: COLLECT_MAX_PAGES * 4,
    onLog: (l) => emitLog(onLog, l.level, l.message, '[Collect]'),
  });

  return {
    success: loopResult.goalAchieved,
    message: loopResult.finalMessage,
    actions: loopResult.actions,
  };
}

async function executeCheckStep(
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<boolean> {
  if (!step.instruction) throw new Error('check step requires an instruction');

  emitLog(onLog, 'info', `Checking condition (with up to ${CHECK_POLL_MAX_MS}ms settle): "${step.instruction}"`, '[Check]');

  const deadline = Date.now() + CHECK_POLL_MAX_MS;

  while (Date.now() < deadline) {
    const matchFound = await page.evaluate((query: string) => {
      const doc = (globalThis as any).document;
      if (!doc) return false;
      const q = query.toLowerCase();
      const nodes = Array.from(doc.querySelectorAll('input, button, a, select, [role="button"], [role="alert"], h1, h2, h3, p, span, div'));
      for (const node of nodes) {
        const el = node as any;
        const text = (el.textContent || '').trim().toLowerCase();
        const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase();
        if (text.includes(q) || label.includes(q)) return true;
      }
      return false;
    }, step.instruction);

    if (matchFound) {
      emitLog(onLog, 'info', `Condition TRUE (matched "${step.instruction}").`, '[Check]');
      return true;
    }

    await sleep(CHECK_POLL_INTERVAL_MS);
  }

  emitLog(onLog, 'info', `Condition FALSE after ${CHECK_POLL_MAX_MS}ms settling window.`, '[Check]');
  return false;
}

function emitLog(
  onLog: WorkflowLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[Workflow]',
): void {
  const line = `${prefix} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  onLog({ level, message });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
