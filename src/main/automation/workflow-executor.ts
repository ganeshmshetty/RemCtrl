/**
 * @file workflow-executor.ts
 * @description Coordinates and executes structured multi-step automation workflows with built-in retry mechanics, branching logic, and AI-assisted self-healing.
 * Key Exported APIs: `runWorkflow`, `cancelWorkflow`, `isWorkflowRunning`, `setWorkflowPaused`, `WorkflowRunStatusCb`, `WorkflowStepStatusCb`, and `WorkflowLogCb`.
 * Internal Mechanics: Drives the execution cycle through parsed workflow steps (`navigate`, `click`, `fill`, `select`, `keypress`, `wait`, `extract`, `check`). Checks conditional state polling, implements exponential backoff retries on failure, and handles user pause/resume takeover.
 * AI Self-Healing & Integration: If a fast-path CSS selector fails, invokes the AI tool-calling loop (`runToolLoop`) using the original step description to find the healed element, and persists the repaired selector back to the database.
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
import { getPreferredProvider, getApiKey, updateWorkflowStepSelector } from '../storage.js';
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

const CHECK_POLL_INTERVAL_MS = 500;
const CHECK_POLL_MAX_MS = 3_000;
const WORKFLOW_MAX_TRANSITIONS = 100;



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
  const { workflowRunId, name, steps } = payload;
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

      const resolvedStep = { ...step } as WorkflowStep;

      const stepLabel = `Step ${index + 1}/${steps.length} [${resolvedStep.type.toUpperCase()}]`;

      onRunStatus({ workflowRunId, state: 'running', currentStepIndex: index });
      onStepStatus({ workflowRunId, stepId: step.id, index, state: 'running' });
      emitLog(onLog, 'info', `▶ ${stepLabel}`, '[Workflow]');

      try {
        const result = await executeStepWithRetry(localPage, resolvedStep, payload.workflowId, onLog);

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
          jumpToStepId = steps[index + 1]?.id ?? null;
        }

        currentStepId = jumpToStepId;

      } catch (stepErr) {
        const errorInfo = extractError(stepErr);
        emitLog(onLog, 'error', `✗ ${stepLabel} failed: ${errorInfo.message}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: step.id, index, state: 'failed', error: errorInfo.message });

        if (session.isCancelled) {
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
    try {
      if (attempt > 1) {
        emitLog(onLog, 'info', `Attempt ${attempt}/${maxAttempts}`, '[Workflow]');
      }
      return await executeStep(page, step, workflowId, onLog);
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
  workflowId: string,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  await ensureCursorOverlay(page);
  await activeSession?.waitIfPaused(
    () => emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume…', '[Workflow]'),
    () => emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state…', '[Workflow]'),
  );

  switch (step.type) {
    case 'navigate': return executeNavigateStep(page, step as any, onLog);
    case 'click':
    case 'fill':
    case 'select':
    case 'keypress': return executeDeterministicActionWithSelfHeal(page, step as any, workflowId, onLog);
    case 'wait':     return executeWaitStep(page, step as any, onLog);
    case 'extract':  return executeExtractStep(page, step as any, onLog);
    case 'check':    return executeCheckStep(page, step as any, onLog);
    default:
      throw new Error(`Unsupported or legacy step type: ${(step as any).type}`);
  }
}

async function executeDeterministicActionWithSelfHeal(
  page: Page,
  step: Extract<WorkflowStep, { type: 'click' | 'fill' | 'select' | 'keypress' }>,
  workflowId: string,
  onLog: WorkflowLogCb
) {
  try {
    if (step.type !== 'keypress') {
      const locator = page.locator(step.selector);
      // Fast path: wait a brief moment for the selector
      await locator.waitFor({ timeout: 3000, state: 'visible' });
      
      if (step.type === 'click') {
        const msg = `Action: click on ${step.selector}`;
        emitLog(onLog, 'info', msg, '');
        if (activeSession?.journal) {
          await activeSession.journal.recordAgentStep('act', { action: 'click', selector: step.selector }, null, msg);
        }
        await locator.click();
      } else if (step.type === 'fill') {
        const msg = `Action: fill "${step.value}" on ${step.selector}`;
        emitLog(onLog, 'info', msg, '');
        if (activeSession?.journal) {
          await activeSession.journal.recordAgentStep('act', { action: 'fill', selector: step.selector, value: step.value }, null, msg);
        }
        await locator.fill(step.value);
      } else if (step.type === 'select') {
        const msg = `Action: select "${step.value}" on ${step.selector}`;
        emitLog(onLog, 'info', msg, '');
        if (activeSession?.journal) {
          await activeSession.journal.recordAgentStep('act', { action: 'select', selector: step.selector, value: step.value }, null, msg);
        }
        await locator.selectOption(step.value);
      }
    } else {
      const msg = `Pressing key: ${step.key}`;
      emitLog(onLog, 'info', msg, '');
      if (activeSession?.journal) {
        await activeSession.journal.recordAgentStep('keys', { key: step.key }, null, msg);
      }
      await page.keyboard.press(step.key);
    }
    return { success: true };
  } catch (err) {
    if (step.type === 'keypress') throw err; // Cannot self-heal a pure keypress easily
    if (step.onFailure !== 'self_heal') throw err; // Enforce onFailure policy (bypasses self-healing if stop/skip/retry)
    
    emitLog(onLog, 'warn', `Fast path failed for ${step.selector}. Triggering AI Self-Healing...`, '[SelfHeal]');
    
    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);
    const model = resolveModel(provider, apiKey);

    // Provide the original semantic description to the agent so it knows what it's looking for
    const instruction = `The automated workflow failed to find the element previously saved as "${step.selector}".
However, the user originally described their intent as: "${step.description || 'Unknown'}".
Please find the correct element that matches this description on the current page, and perform the '${step.type}' action on it.
${step.type === 'fill' ? `The value to fill is: "${step.value}"` : ''}
${step.type === 'select' ? `The value to select is: "${step.value}"` : ''}
End your turn with 'done' once you have successfully interacted with it.`;

    const loopResult = await runToolLoop({
      commandId: `self-heal-${step.id}`,
      instruction,
      systemPrompt: buildWorkflowStepSystemPrompt('do', instruction), // reuse generic prompt
      page,
      session: (() => {
        if (!activeSession) throw new Error('Cannot self-heal: workflow session is no longer active');
        return activeSession;
      })(),
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
  page: Page,
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
  if (activeSession?.journal) {
    await activeSession.journal.recordAgentStep('goto', { url: targetUrl }, null, msg);
  }
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

async function executeExtractStep(
  page: Page,
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
    systemPrompt: buildWorkflowStepSystemPrompt('collect', step.instruction), // Reuse collect prompt logic
    page,
    session: (() => {
      if (!activeSession) throw new Error('Cannot run extract step: workflow session is no longer active');
      return activeSession;
    })(),
    model,
    maxSteps: 15,
    onLog: (l) => emitLog(onLog, l.level, l.message, '[Extract]'),
  });

  const msg = `Extracting from page`;
  if (activeSession?.journal) {
    await activeSession.journal.recordAgentStep('extract', { instruction: step.instruction }, loopResult.finalMessage, msg);
  }

  return {
    success: loopResult.goalAchieved,
    message: loopResult.finalMessage,
    actions: loopResult.actions,
  };
}

async function executeWaitStep(
  _page: Page,
  step: Extract<WorkflowStep, { type: 'wait' }>,
  onLog: WorkflowLogCb,
): Promise<unknown> {
  emitLog(onLog, 'info', `Waiting for ${step.ms}ms`, '[Wait]');
  await sleep(step.ms);
  return { success: true };
}

async function executeCheckStep(
  page: Page,
  step: Extract<WorkflowStep, { type: 'check' }>,
  onLog: WorkflowLogCb,
): Promise<boolean> {
  if (!step.condition) throw new Error('check step requires a condition');

  const msg = `Action: check condition "${step.condition}"`;
  emitLog(onLog, 'info', msg, '');

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
    }, step.condition);

    if (matchFound) {
      emitLog(onLog, 'info', `Condition TRUE (matched "${step.condition}").`, '[Check]');
      if (activeSession?.journal) {
        await activeSession.journal.recordAgentStep('act', { action: 'check', selector: step.condition }, true, msg);
      }
      return true;
    }
    await sleep(CHECK_POLL_INTERVAL_MS);
  }

  emitLog(onLog, 'info', `Condition FALSE after ${CHECK_POLL_MAX_MS}ms.`, '[Check]');
  if (activeSession?.journal) {
    await activeSession.journal.recordAgentStep('act', { action: 'check', selector: step.condition }, false, msg);
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
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  onLog({ level, message });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
