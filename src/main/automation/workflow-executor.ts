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

import { Stagehand } from '@browserbasehq/stagehand';
import { getStagehand } from './stagehand-pool.js';
import type { Page } from 'playwright';
import { getStagehandModelConfig } from './model-resolver.js';
import type {
  AgentWorkflowBatchPayload,
  WorkflowStep,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentLogPayload,
} from '../../shared/types.js';
import { getPage, getCdpUrl } from '../browser-manager.js';
import { getPreferredProvider, getApiKey } from '../storage.js';
import {
  StallDetector,
  createPageFingerprint,
} from './stall-detector.js';
import {
  AgentStalledError,
  BrowserNotReadyError,
  extractError,
} from '../errors.js';
import { TaskSession } from './task-session.js';

// ─── Callback Types ─────────────────────────────────────────────────────────

export type WorkflowRunStatusCb = (s: WorkflowRunStatus) => void;
export type WorkflowStepStatusCb = (s: WorkflowStepStatus) => void;
export type WorkflowLogCb = (l: AgentLogPayload) => void;

// ─── Configuration ──────────────────────────────────────────────────────────

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 10_000;
const RETRY_BACKOFF = 2;
const STALL_CHECK_INTERVAL = 3;

/** Max sub-actions inside a single `do` step ReAct loop */
const DO_MAX_STEPS = 8;
/** Max pages to paginate through in a `collect` step */
const COLLECT_MAX_PAGES = 10;
/** Polling window for `check` implicit DOM settling (ms) */
const CHECK_POLL_INTERVAL_MS = 500;
const CHECK_POLL_MAX_MS = 3_000;
const WORKFLOW_MAX_TRANSITIONS = 100;

// ─── Module-level session ────────────────────────────────────────────────────
// One session at a time. Public helpers below delegate to it.

let activeSession: TaskSession | null = null;

// ─── Public API ─────────────────────────────────────────────────────────────

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

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function runWorkflow(
  payload: AgentWorkflowBatchPayload,
  onRunStatus: WorkflowRunStatusCb,
  onStepStatus: WorkflowStepStatusCb,
  onLog: WorkflowLogCb,
): Promise<void> {
  const { workflowRunId, name, startUrl, steps } = payload;

  if (activeSession?.isActive) {
    const msg = 'Another workflow is already running.';
    emitLog(onLog, 'warn', msg, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();

  if (!page || !cdpUrl) {
    const err = new BrowserNotReadyError('Launch a browser from the Host session first.');
    emitLog(onLog, 'error', err.message, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'failed', error: err.message });
    return;
  }

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);

  if (!apiKey) {
    const msg = `No API key for provider "${provider}". Configure it in Settings.`;
    emitLog(onLog, 'error', msg, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const stagehandConfig = getStagehandModelConfig(provider, apiKey);

  const session = new TaskSession();
  activeSession = session;
  session.start();

  // Build step index for O(1) lookup (needed for check branching) and validate graph
  const stepMap = new Map<string, { step: WorkflowStep; index: number }>();
  for (const [i, s] of steps.entries()) {
    if (stepMap.has(s.id)) {
      const msg = `Duplicate workflow step ID "${s.id}".`;
      emitLog(onLog, 'error', msg, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'failed', error: msg });
      return;
    }
    stepMap.set(s.id, { step: s, index: i });
  }

  for (const s of steps) {
    for (const target of [s.onTrue, s.onFalse]) {
      if (target && !stepMap.has(target)) {
        const msg = `Step "${s.id}" branches to unknown step ID "${target}".`;
        emitLog(onLog, 'error', msg, '[Workflow]');
        onRunStatus({ workflowRunId, state: 'failed', error: msg });
        return;
      }
    }
  }

  onRunStatus({ workflowRunId, state: 'running', currentStepIndex: 0 });
  emitLog(onLog, 'info', `Workflow "${name}" started — ${steps.length} step(s), model="${stagehandConfig.modelName}"`, '[Workflow]');

  let stagehand: Stagehand | null = null;

  try {
    emitLog(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`, '[Workflow]');

    stagehand = await getStagehand(cdpUrl, stagehandConfig, (level, msg) => {
      emitLog(onLog, level, msg, '[Stagehand]');
    });

    // Navigate to startUrl if provided
    if (startUrl) {
      emitLog(onLog, 'info', `Navigating to start URL: ${startUrl}`, '[Workflow]');
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch((e: Error) => {
        emitLog(onLog, 'warn', `Start URL navigation warning: ${e.message}`, '[Workflow]');
      });
    }

    // ── Jump-based execution loop ──────────────────────────────────────────
    // We track the current step by ID rather than index so that `check` steps
    // can branch freely without re-indexing.

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
        const entry = stepMap.get(currentStepId);
        emitLog(onLog, 'info', `Workflow cancelled before step "${currentStepId}"`, '[Workflow]');
        if (entry) {
          onStepStatus({ workflowRunId, stepId: currentStepId, index: entry.index, state: 'skipped' });
        }
        onRunStatus({ workflowRunId, state: 'cancelled' });
        return;
      }

      const entry = stepMap.get(currentStepId);
      if (!entry) {
        const msg = `Step ID "${currentStepId}" not found in step map.`;
        emitLog(onLog, 'error', msg, '[Workflow]');
        onRunStatus({ workflowRunId, state: 'failed', error: msg });
        return;
      }

      const { step, index } = entry;
      const stepLabel = `Step ${index + 1}/${steps.length} [${step.type.toUpperCase()}]`;

      emitLog(onLog, 'info', `━━ ${stepLabel}${step.instruction ? `: "${step.instruction}"` : step.url ? `: ${step.url}` : ''}`, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'running', currentStepId: step.id, currentStepIndex: index });
      onStepStatus({ workflowRunId, stepId: step.id, index, state: 'running' });

      // Determine the next step ID linearly (default advancement)
      const nextStepId = steps[index + 1]?.id ?? null;

      let jumpToStepId: string | null = nextStepId; // may be overridden by `check`

      try {
        const activePage = await stagehand.context.activePage();
        if (!activePage) throw new Error('Stagehand cannot find an active page to operate on.');
        
        const result = await executeStepWithRetry(stagehand, activePage as any, step, onLog);

        if (session.isCancelled) {
          onStepStatus({ workflowRunId, stepId: step.id, index, state: 'skipped' });
          onRunStatus({ workflowRunId, state: 'cancelled' });
          return;
        }

        // `check` steps return a boolean — branch accordingly
        if (step.type === 'check') {
          const conditionMet = result as boolean;
          emitLog(onLog, 'info', `✓ ${stepLabel} — condition: ${conditionMet ? 'TRUE' : 'FALSE'}`, '[Workflow]');
          onStepStatus({ workflowRunId, stepId: step.id, index, state: 'completed', result: conditionMet });

          if (conditionMet && step.onTrue) {
            jumpToStepId = step.onTrue;
          } else if (!conditionMet && step.onFalse) {
            jumpToStepId = step.onFalse;
          }
          // If no branch defined, fall through to nextStepId (already default)
        } else {
          emitLog(onLog, 'info', `✓ ${stepLabel} completed.`, '[Workflow]');
          onStepStatus({ workflowRunId, stepId: step.id, index, state: 'completed', result });
        }

        currentStepId = jumpToStepId;

      } catch (stepErr) {
        const errorInfo = extractError(stepErr);
        emitLog(onLog, 'error', `✗ ${stepLabel} failed: ${errorInfo.message}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: step.id, index, state: 'failed', error: errorInfo.message });

        if (step.onFailure === 'skip') {
          emitLog(onLog, 'warn', `onFailure=skip — continuing to next step.`, '[Workflow]');
          currentStepId = nextStepId;
        } else {
          // 'stop' — abort workflow
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
    activeSession = null;
    stagehand = null;
  }
}

// ─── Step Execution with Retry ──────────────────────────────────────────────

async function executeStepWithRetry(
  stagehand: Stagehand,
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  let lastError: Error | null = null;
  let attempt = 0;
  const maxAttempts =
    step.type === 'navigate' || step.type === 'check'
      ? RETRY_MAX_ATTEMPTS
      : 1;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      if (attempt > 1) {
        emitLog(onLog, 'info', `Attempt ${attempt}/${maxAttempts}`, '[Workflow]');
      }
      return await executeStep(stagehand, page, step, onLog);
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

// ─── Step Dispatcher ────────────────────────────────────────────────────────

async function executeStep(
  stagehand: Stagehand,
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  await activeSession?.waitIfPaused(
    () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
    () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
  );

  switch (step.type) {
    case 'navigate': return executeNavigateStep(page, step, onLog);
    case 'do':       return executeDoStep(stagehand, page, step, onLog);
    case 'collect':  return executeCollectStep(stagehand, page, step, onLog);
    case 'check':    return executeCheckStep(stagehand, page, step, onLog);
    default: {
      const _exhaustive: never = step.type;
      throw new Error(`Unknown step type: ${_exhaustive}`);
    }
  }
}

// ─── Navigate Step ──────────────────────────────────────────────────────────
// 🌐 Goes to a URL and validates we landed where expected (detects auth walls)

async function executeNavigateStep(
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<{ navigatedTo: string; finalUrl: string; redirected: boolean }> {
  if (!step.url) throw new Error('navigate step requires a url');

  emitLog(onLog, 'info', `Navigating to: ${step.url}`, '[Navigate]');
  await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

  const finalUrl = page.url();
  let redirected = false;

  try {
    const target = new URL(step.url);
    const actual = new URL(finalUrl);
    redirected = target.hostname !== actual.hostname || target.pathname !== actual.pathname;
  } catch {
    // URL parse failure — ignore redirect check
  }

  if (redirected) {
    emitLog(onLog, 'warn', `Redirected: ${step.url} → ${finalUrl}. Page may be an auth wall or interstitial.`, '[Navigate]');
  } else {
    emitLog(onLog, 'info', `Arrived at: ${finalUrl}`, '[Navigate]');
  }

  return { navigatedTo: step.url, finalUrl, redirected };
}

// ─── Do Step ────────────────────────────────────────────────────────────────
// 👆 Mini-agent ReAct loop: runs at most DO_MAX_STEPS atomic actions until the
//    LLM declares GOAL_ACHIEVED or the step budget is exhausted.

async function executeDoStep(
  stagehand: Stagehand,
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  if (!step.instruction) throw new Error('do step requires an instruction');

  const stallDetector = new StallDetector();
  const initialFp = await createPageFingerprint(page);
  stallDetector.recordFingerprint(initialFp);

  const completedActions: string[] = [];
  let lastResult: unknown = null;
  let successfulActions = 0;
  let goalAchieved = false;

  for (let i = 0; i < DO_MAX_STEPS; i++) {
    await activeSession?.waitIfPaused(
      () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
      () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
    );
    if (activeSession?.isCancelled) break;

    const context = completedActions.length
      ? `Actions completed so far:\n${completedActions.map((a, n) => `  ${n + 1}. ${a}`).join('\n')}\n\n`
      : '';

    const prompt =
      `${context}Overall goal: "${step.instruction}"\n\n` +
      `Perform only the NEXT single action needed. ` +
      `If the goal is already achieved, output exactly "GOAL_ACHIEVED" as your action description.`;

    emitLog(onLog, 'info', `Do sub-action ${i + 1}: ${step.instruction}`, '[Do]');

    try {
      const result = await stagehand.act(prompt, { page });
      lastResult = result;
      successfulActions++;

      const desc: string =
        (result as any)?.actionDescription ??
        (result as any)?.message ??
        JSON.stringify(result);

      completedActions.push(desc);
      emitLog(onLog, 'info', `Sub-action ${i + 1}: ${desc}`, '[Do]');

      if (desc.includes('GOAL_ACHIEVED')) {
        emitLog(onLog, 'info', `Goal achieved after ${i + 1} sub-action(s).`, '[Do]');
        goalAchieved = true;
        break;
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error';
      emitLog(onLog, 'warn', `Sub-action ${i + 1} failed: ${msg}. Adding context and retrying.`, '[Do]');
      completedActions.push(`FAILED: ${msg} — try a different approach.`);
    }

    // Stall check every STALL_CHECK_INTERVAL sub-actions
    if ((i + 1) % STALL_CHECK_INTERVAL === 0) {
      const fp = await createPageFingerprint(page);
      stallDetector.recordFingerprint(fp);
      const stallCheck = stallDetector.isStuck();
      if (stallCheck.stuck) {
        const nudge = stallDetector.getLoopNudgeMessage();
        if (nudge) emitLog(onLog, 'info', `Stall nudge: ${nudge}`, '[Do]');
        throw new AgentStalledError(stallCheck.reason, true);
      }
    }

    await sleep(800);
  }

  if (successfulActions === 0) {
    throw new Error(`Do step failed: all ${DO_MAX_STEPS} sub-action attempts failed for "${step.instruction}"`);
  }

  if (!goalAchieved) {
    throw new Error(`Do step did not reach GOAL_ACHIEVED within ${DO_MAX_STEPS} sub-actions for "${step.instruction}"`);
  }

  return lastResult ?? { success: true, message: 'Do step completed.' };
}

// ─── Collect Step ────────────────────────────────────────────────────────────
// 📋 Extracts structured data. Supports simple pagination (Next button / scroll).

async function executeCollectStep(
  stagehand: Stagehand,
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  if (!step.instruction) throw new Error('collect step requires an instruction');

  emitLog(onLog, 'info', `Collecting: "${step.instruction}"`, '[Collect]');

  const allResults: unknown[] = [];

  for (let pageNum = 0; pageNum < COLLECT_MAX_PAGES; pageNum++) {
    await activeSession?.waitIfPaused(
      () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
      () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
    );
    if (activeSession?.isCancelled) break;

    emitLog(onLog, 'info', `Extracting page ${pageNum + 1}…`, '[Collect]');
    const result = await stagehand.extract(step.instruction, { page });
    allResults.push(result);

    if (activeSession?.isCancelled) break;

    // Try to find and click a "Next" pagination button
    const nextObservation = await stagehand.observe(
      'Is there a visible "Next page" or "Load more" button that is not disabled?',
      { page },
    );

    // observe returns an array of candidate elements
    const candidates = Array.isArray(nextObservation) ? nextObservation : [];
    const hasNext = candidates.length > 0;

    if (!hasNext) {
      emitLog(onLog, 'info', `No more pages detected after page ${pageNum + 1}.`, '[Collect]');
      break;
    }

    emitLog(onLog, 'info', `Paginating to page ${pageNum + 2}…`, '[Collect]');
    try {
      await stagehand.act('Click the "Next page" or "Load more" button.', { page });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    } catch {
      emitLog(onLog, 'warn', 'Pagination click failed — stopping collection.', '[Collect]');
      break;
    }
  }

  const flattened =
    allResults.length === 1
      ? allResults[0]
      : allResults.every(Array.isArray)
        ? allResults.flat()
        : allResults;
  emitLog(onLog, 'info', `Collection complete — ${allResults.length} page(s) processed.`, '[Collect]');
  return flattened;
}

// ─── Check Step ─────────────────────────────────────────────────────────────
// 🔀 Polls the DOM for up to CHECK_POLL_MAX_MS before returning a boolean,
//    avoiding false-negatives caused by slow-rendering elements.

async function executeCheckStep(
  stagehand: Stagehand,
  page: Page,
  step: WorkflowStep,
  onLog: WorkflowLogCb,
): Promise<boolean> {
  if (!step.instruction) throw new Error('check step requires an instruction');

  emitLog(onLog, 'info', `Checking condition (with up to ${CHECK_POLL_MAX_MS}ms settle): "${step.instruction}"`, '[Check]');

  const deadline = Date.now() + CHECK_POLL_MAX_MS;
  let lastResult = false;

  while (Date.now() < deadline) {
    const observations = await stagehand.observe(step.instruction, { page });
    const candidates = Array.isArray(observations) ? observations : [];
    lastResult = candidates.length > 0;

    if (lastResult) {
      emitLog(onLog, 'info', `Condition TRUE (matched ${candidates.length} element(s)).`, '[Check]');
      return true;
    }

    // Not yet true — wait a tick before retrying
    await sleep(CHECK_POLL_INTERVAL_MS);
  }

  emitLog(onLog, 'info', `Condition FALSE after ${CHECK_POLL_MAX_MS}ms settling window.`, '[Check]');
  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────────────



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
