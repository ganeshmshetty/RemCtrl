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
import type { Page } from 'playwright';
import { getPreferredModel } from './storage.js';
import type {
  AgentWorkflowBatchPayload,
  WorkflowStep,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentLogPayload,
} from '../shared/types.js';
import { getPage, getCdpUrl } from './browser-manager.js';
import { getPreferredProvider, getApiKey } from './storage.js';
import {
  StallDetector,
  createPageFingerprint,
} from './stall-detector.js';
import {
  AgentStalledError,
  BrowserNotReadyError,
  StagehandConnectionError,
  extractError,
} from './errors.js';

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

// ─── Module State ───────────────────────────────────────────────────────────

let activeRunId: string | null = null;
let cancelRequested = false;
let isPaused = false;

// ─── Public API ─────────────────────────────────────────────────────────────

export function isWorkflowRunning(): boolean {
  return activeRunId !== null;
}

export function cancelWorkflow(): void {
  if (activeRunId) cancelRequested = true;
}

export function setWorkflowPaused(paused: boolean): void {
  isPaused = paused;
}

async function waitForResume(onLog: WorkflowLogCb): Promise<void> {
  if (!isPaused) return;
  emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]');
  while (isPaused && !cancelRequested) {
    await sleep(500);
  }
  if (!cancelRequested) {
    emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]');
  }
}

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function runWorkflow(
  payload: AgentWorkflowBatchPayload,
  onRunStatus: WorkflowRunStatusCb,
  onStepStatus: WorkflowStepStatusCb,
  onLog: WorkflowLogCb,
): Promise<void> {
  const { workflowRunId, name, startUrl, steps } = payload;

  if (activeRunId) {
    const msg = `Another workflow (${activeRunId}) is already running.`;
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

  const modelName = getModelName(provider);

  activeRunId = workflowRunId;
  cancelRequested = false;

  // Build step index for O(1) lookup (needed for check branching)
  const stepMap = new Map<string, { step: WorkflowStep; index: number }>();
  steps.forEach((s, i) => stepMap.set(s.id, { step: s, index: i }));

  onRunStatus({ workflowRunId, state: 'running', currentStepIndex: 0 });
  emitLog(onLog, 'info', `Workflow "${name}" started — ${steps.length} step(s), model="${modelName}"`, '[Workflow]');

  let stagehand: Stagehand | null = null;

  try {
    emitLog(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`, '[Workflow]');

    stagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: { modelName, apiKey },
      logger: (line: any) => {
        const level = (line.level || 'info') as AgentLogPayload['level'];
        const msg: string = line.message ?? (typeof line === 'object' ? JSON.stringify(line) : String(line));
        emitLog(onLog, level, msg, '[Stagehand]');
      },
      verbose: 2,
    });

    emitLog(onLog, 'info', 'Initialising Stagehand…', '[Workflow]');
    try {
      await stagehand.init();
    } catch (initErr: any) {
      throw new StagehandConnectionError(initErr?.message ?? String(initErr));
    }
    emitLog(onLog, 'info', 'Stagehand ready.', '[Workflow]');

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

    while (currentStepId !== null) {
      if (isPaused) await waitForResume(onLog);

      if (cancelRequested) {
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
        emitLog(onLog, 'warn', `Step ID "${currentStepId}" not found in step map — stopping.`, '[Workflow]');
        break;
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
        const result = await executeStepWithRetry(stagehand, page, step, onLog);

        if (cancelRequested) {
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
    if (cancelRequested) {
      emitLog(onLog, 'info', 'Workflow cancelled.', '[Workflow]');
      onRunStatus({ workflowRunId, state: 'cancelled' });
    } else {
      emitLog(onLog, 'error', `Workflow failed: ${errorInfo.message}`, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'failed', error: errorInfo.message });
    }
  } finally {
    activeRunId = null;
    cancelRequested = false;
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

  while (attempt < RETRY_MAX_ATTEMPTS) {
    attempt++;
    try {
      if (attempt > 1) {
        emitLog(onLog, 'info', `Attempt ${attempt}/${RETRY_MAX_ATTEMPTS}`, '[Workflow]');
      }
      return await executeStep(stagehand, page, step, onLog);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorInfo = extractError(lastError);

      emitLog(onLog, 'warn', `Attempt ${attempt} failed: ${errorInfo.message}`, '[Workflow]');

      if (attempt === RETRY_MAX_ATTEMPTS || !errorInfo.retryable) break;

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
  if (isPaused) await waitForResume(onLog);

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

  for (let i = 0; i < DO_MAX_STEPS; i++) {
    if (isPaused) await waitForResume(onLog);
    if (cancelRequested) break;

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
    emitLog(onLog, 'info', `Extracting page ${pageNum + 1}…`, '[Collect]');
    const result = await stagehand.extract(step.instruction, { page });
    allResults.push(result);

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

  const flattened = allResults.length === 1 ? allResults[0] : allResults;
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

function getModelName(provider: string): string {
  const preferred = getPreferredModel();
  if (preferred) return preferred;

  switch (provider) {
    case 'openai':      return 'gpt-4o';
    case 'anthropic':   return 'claude-3-5-sonnet-latest';
    case 'gemini':      return 'gemini-1.5-pro';
    case 'groq':        return 'llama-3.3-70b-versatile';
    case 'deepseek':    return 'deepseek-chat';
    case 'nebius':      return 'meta-llama/Llama-3.3-70B-Instruct';
    case 'openrouter':  return 'anthropic/claude-3.5-sonnet';
    default:            return 'gpt-4o';
  }
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
