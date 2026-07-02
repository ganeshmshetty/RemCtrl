/**
 * Robust Agent Executor — Phase 1 Implementation
 * 
 * Features:
 * - Stall detection with automatic recovery suggestions
 * - Retry logic with exponential backoff
 * - Better error handling with actionable messages
 * - Execution logging for debugging
 * 
 * Inspired by: Open Browser, Magnitude, and Stagehand best practices
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { getStagehand, closeStagehand } from './stagehand-pool.js';
import { getPage, getCdpUrl } from '../browser-manager.js';
import { parseInstruction } from './instruction-parser.js';
import { getStagehandModelConfig } from './model-resolver.js';
import type { AgentStatusPayload, AgentLogPayload, ApiProvider } from '../../shared/types.js';
import type { Page } from 'playwright';
import {
  StallDetector,
  createPageFingerprint,
} from './stall-detector.js';
import {
  AgentStalledError,
  AgentTimeoutError,
  RetryExhaustedError,
  BrowserNotReadyError,
  extractError,
} from '../errors.js';
import { ExecutionLogger } from './execution-logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;

interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

const COMMAND_TIMEOUT_MS = 90_000;
const STALL_CHECK_INTERVAL = 3; // Check for stalls every N steps

// ─── Module State ───────────────────────────────────────────────────────────

let activeCommandId: string | null = null;
let cancelRequested = false;
let executionLogger: ExecutionLogger | null = null;
let isPaused = false;

// ─── Public API ─────────────────────────────────────────────────────────────

export function isAgentRunning(): boolean {
  return activeCommandId !== null;
}

/**
 * Execute an agent command with robust error handling, retries, and stall detection.
 */
export async function runAgentCommand(
  commandId: string,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  apiKey: string,
  provider: ApiProvider,
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
): Promise<void> {
  // Reject if already running
  if (activeCommandId !== null) {
    const msg = `Another command (${activeCommandId}) is already running. Cancel it first.`;
    emitLog(onLog, 'warn', msg, '[Agent]');
    onStatus({ commandId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();

  if (!page || !cdpUrl) {
    const err = new BrowserNotReadyError('Launch a browser from the Host session first.');
    emitLog(onLog, 'error', err.message, '[Agent]');
    onStatus({ commandId, state: 'failed', error: err.message });
    return;
  }

  activeCommandId = commandId;
  cancelRequested = false;
  executionLogger = new ExecutionLogger(commandId, instruction);

  const stagehandConfig = getStagehandModelConfig(provider, apiKey);

  emitLog(onLog, 'info', `Starting — action="${action}" model="${stagehandConfig.modelName}"`, '[Agent]');
  onStatus({ commandId, state: 'running' });

  let localStagehand: Stagehand | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  let cancelIntervalId: NodeJS.Timeout | undefined;

  try {
    emitLog(onLog, 'info', 'Connecting to local browser via CDP...', '[Agent]');

    localStagehand = await getStagehand(cdpUrl, stagehandConfig, (level, msg) => {
      emitLog(onLog, level, msg, '[Stagehand]');
    });

    // Setup timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentTimeoutError(COMMAND_TIMEOUT_MS)),
        COMMAND_TIMEOUT_MS,
      );
    });

    // Setup cancellation
    const cancelPromise = new Promise<never>((_, reject) => {
      cancelIntervalId = setInterval(() => {
        if (cancelRequested) reject(new Error('Cancelled by user'));
      }, 200);
    });

    // Execute with retries
    const stallDetector = new StallDetector();
    const result = await Promise.race([
      executeWithRetries(localStagehand, page, action, instruction, onLog, stallDetector),
      timeoutPromise,
      cancelPromise,
    ]);

    if (cancelRequested) {
      executionLogger?.cancel();
      emitLog(onLog, 'info', 'Command cancelled.', '[Agent]');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      executionLogger?.complete();
      const summary = executionLogger?.getSummary();
      if (summary) {
        emitLog(onLog, 'info',
          `Command completed in ${summary.totalDuration}ms — ${summary.totalSteps} step(s).`,
          '[Agent]');
      }
      onStatus({ commandId, state: 'completed', result });
    }
  } catch (err) {
    if (cancelRequested) {
      executionLogger?.cancel();
    } else {
      executionLogger?.fail();
    }
    await closeStagehand().catch(() => {});
    handleError(err, commandId, onLog, onStatus);
  } finally {
    clearTimeout(timeoutId);
    clearInterval(cancelIntervalId);
    activeCommandId = null;
    cancelRequested = false;
    localStagehand = null;
    executionLogger = null;
  }
}

export function cancelAgentCommand(): void {
  if (activeCommandId) {
    cancelRequested = true;
  }
}

export function setAgentPaused(paused: boolean): void {
  isPaused = paused;
}

async function waitForResume(onLog: AgentLogCb): Promise<void> {
  if (!isPaused) return;
  emitLog(onLog, 'info', 'Agent paused for manual takeover. Waiting for resume...', '[Agent]');
  while (isPaused && !cancelRequested) {
    await sleep(500);
  }
  if (!cancelRequested) {
    emitLog(onLog, 'info', 'Agent resumed. Capturing fresh page state...', '[Agent]');
  }
}

// ─── Execution with Retries ─────────────────────────────────────────────────

async function executeWithRetries(
  stagehand: Stagehand,
  page: Page,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  onLog: AgentLogCb,
  stallDetector: StallDetector,
): Promise<any> {
  const config = DEFAULT_RETRY_CONFIG;
  let lastError: Error | null = null;
  let attempt = 0;
  const maxAttempts = action === 'act' ? 1 : config.maxAttempts;

  while (attempt < maxAttempts) {
    attempt++;
    const isLastAttempt = attempt === maxAttempts;

    try {
      emitLog(onLog, 'info', `Attempt ${attempt}/${maxAttempts}`, '[Agent]');
      const result = await executeWithStallDetection(stagehand, page, action, instruction, onLog, stallDetector);

      if (attempt > 1) {
        emitLog(onLog, 'info', `Succeeded on attempt ${attempt}`, '[Agent]');
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorInfo = extractError(lastError);

      emitLog(onLog, 'warn', `Attempt ${attempt} failed: ${errorInfo.message}`, '[Agent]');

      if (!errorInfo.retryable) {
        throw lastError;
      }

      if (isLastAttempt) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelayMs,
      );

      emitLog(onLog, 'info', `Retrying in ${delay}ms...`, '[Agent]');
      await sleep(delay);
    }
  }

  // All retries exhausted
  throw new RetryExhaustedError(attempt, lastError!);
}

// ─── Multi-step post-navigation action runner ─────────────────────────────────
//
// After navigating to a page, the remaining goal (e.g. "search for a good song
// and play it") usually requires several sequential DOM actions. Stagehand.act()
// is atomic (one action per call), so we run a small ReAct-style loop:
//   observe → decide next single action → act → check if done → repeat
//
// Inspired by browser-use's multi_act() with terminates_sequence semantics.

const POST_NAV_MAX_STEPS = 8;

async function executeMultiStepAction(
  stagehand: Stagehand,
  page: Page,
  goal: string,
  onLog: AgentLogCb,
  stallDetector: StallDetector,
): Promise<any> {
  let lastResult: any = null;
  const completedSteps: string[] = [];
  let successfulSteps = 0;
  let goalAchieved = false;

  for (let step = 0; step < POST_NAV_MAX_STEPS; step++) {
    if (isPaused) {
      await waitForResume(onLog);
      if (cancelRequested) break;
    }

    // Build a focused single-action prompt with full context
    const contextSummary = completedSteps.length
      ? `Steps already done:\n${completedSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n\n`
      : '';

    const singleStepPrompt =
      `${contextSummary}` +
      `Overall goal: "${goal}"\n\n` +
      `Perform only the NEXT single action needed to progress towards the goal. ` +
      `CRITICAL: If the goal is already complete, DO NOT take any action. Instead, output the exact phrase "GOAL_ACHIEVED" as your action description.`;

    emitLog(onLog, 'info', `Post-nav step ${step + 1}: ${goal}`, '[Agent]');

    try {
      lastResult = await stagehand.act(singleStepPrompt, { page });
      successfulSteps++;

      const actionDesc: string =
        lastResult?.actionDescription ??
        lastResult?.message ??
        JSON.stringify(lastResult);

      completedSteps.push(actionDesc);
      emitLog(onLog, 'info', `Step ${step + 1} done: ${actionDesc}`, '[Agent]');

      stallDetector.recordAction('act', actionDesc);
      const fp = await createPageFingerprint(page);
      stallDetector.recordFingerprint(fp);
      const stallCheck = stallDetector.isStuck();
      if (stallCheck.stuck) {
        const nudge = stallDetector.getLoopNudgeMessage();
        if (nudge) emitLog(onLog, 'info', `Stall nudge: ${nudge}`, '[Agent]');
        throw new AgentStalledError(stallCheck.reason, true);
      }

      if (actionDesc.includes('GOAL_ACHIEVED')) {
        goalAchieved = true;
        emitLog(onLog, 'info', `Goal achieved after ${step + 1} step(s).`, '[Agent]');
        break;
      }
    } catch (error: any) {
      if (error instanceof AgentStalledError) throw error;
      const errorMsg = error?.message || 'Unknown execution error';
      emitLog(onLog, 'warn', `Step ${step + 1} failed: ${errorMsg}. Retrying...`, '[Agent]');
      // Push the failure into context so the LLM knows what NOT to do next time
      completedSteps.push(`FAILED PREVIOUS ATTEMPT: ${errorMsg}. Do not repeat this exact action. Try an alternative approach.`);
    }

    // Small pause to let page settle between actions
    await new Promise((r) => setTimeout(r, 800));
  }

  if (successfulSteps === 0 && lastResult === null) {
    throw new Error(`Multi-step action failed: all ${POST_NAV_MAX_STEPS} attempts failed`);
  }

  if (!goalAchieved) {
    throw new Error(`Multi-step action stopped after ${POST_NAV_MAX_STEPS} steps before the goal was achieved`);
  }

  return lastResult ?? { success: true, message: 'Multi-step action completed.' };
}

// ─── Stall Detection Wrapper ────────────────────────────────────────────────

async function executeWithStallDetection(
  stagehand: Stagehand,
  page: Page,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  onLog: AgentLogCb,
  stallDetector: StallDetector,
): Promise<any> {
  let step = 0;
  let lastStallCheck = 0;

  if (isPaused) {
    await waitForResume(onLog);
  }

  // Get initial fingerprint
  const initialFingerprint = await createPageFingerprint(page);
  stallDetector.recordFingerprint(initialFingerprint);

  const result = await (async () => {
    if (action === 'act') {
      // Parse instruction: split navigation from post-nav action
      // Inspired by browser-use (terminates_sequence) + nanobrowser (Planner decomposition)
      const parsed = await parseInstruction(instruction, page.url());

      if (parsed.navigationUrl) {
        emitLog(onLog, 'info', `Navigation intent detected → ${parsed.navigationUrl}`, '[Agent]');
        await page.goto(parsed.navigationUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        // Wait for page to settle before acting (mirrors nanobrowser's page-state-change guard)
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { });

        if (parsed.navigationOnly || !parsed.remainingAction) {
          return { success: true, navigatedTo: parsed.navigationUrl };
        }

        emitLog(onLog, 'info', `Executing post-navigation action: "${parsed.remainingAction}"`, '[Agent]');
        return await executeMultiStepAction(stagehand, page, parsed.remainingAction, onLog, stallDetector);
      }

      // No navigation — pass full instruction to Stagehand
      return await stagehand.act(instruction, { page });
    }

    if (action === 'observe') {
      return await stagehand.observe(instruction, { page });
    }

    if (action === 'extract') {
      return await stagehand.extract(instruction, { page });
    }

    throw new Error(`Unknown action: "${action}"`);
  })();

  // Record action for stall detection
  stallDetector.recordAction(action, instruction);
  step++;

  // Periodic stall check
  if (step % STALL_CHECK_INTERVAL === 0 || lastStallCheck === 0) {
    const currentFingerprint = await createPageFingerprint(page);
    stallDetector.recordFingerprint(currentFingerprint);
    lastStallCheck = step;

    const stallCheck = stallDetector.isStuck();

    if (stallCheck.stuck) {
      emitLog(onLog, 'warn', `Stall detected: ${stallCheck.reason}`, '[Agent]');

      // Get nudge message to help recover
      const nudge = stallDetector.getLoopNudgeMessage();
      if (nudge) {
        emitLog(onLog, 'info', `Recovery suggestion:\n${nudge}`, '[Agent]');
      }

      // Throw stall error for potential recovery strategies
      throw new AgentStalledError(stallCheck.reason, true);
    }
  }

  // Log execution via ExecutionLogger
  executionLogger?.log({
    step,
    action,
    instruction,
    result,
    tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
    duration: 0,
    pageState: {
      url: page.url(),
      title: '',
      elementCount: 0,
    },
  });

  return result;
}

// ─── Navigation Detection ────────────────────────────────────────────────────
// Moved to src/main/instruction-parser.ts — see parseInstruction()

// ─── Error Handling ─────────────────────────────────────────────────────────

function handleError(
  err: unknown,
  commandId: string,
  onLog: AgentLogCb,
  onStatus: AgentStatusCb,
): void {
  const errorInfo = extractError(err);

  if (cancelRequested) {
    emitLog(onLog, 'info', 'Command cancelled.', '[Agent]');
    onStatus({ commandId, state: 'cancelled' });
    return;
  }

  // Provide actionable error messages
  const userMessage = errorInfo.message;
  let suggestion = '';

  if (errorInfo.code === 'TIMEOUT') {
    suggestion = 'Try breaking the task into smaller steps or increasing the timeout.';
  } else if (errorInfo.code === 'RATE_LIMIT') {
    suggestion = 'Rate limit reached. Wait a moment before retrying.';
  } else if (errorInfo.code === 'STAGEHAND_CONNECTION') {
    suggestion = 'Check that the browser is running and CDP URL is correct.';
  } else if (errorInfo.code === 'BROWSER_NOT_READY') {
    suggestion = 'Launch a browser session from the Host screen first.';
  } else if (errorInfo.code === 'STALL') {
    suggestion = 'The agent got stuck. Try rephrasing the instruction or navigating to a different page.';
  }

  const fullMessage = suggestion ? `${userMessage} ${suggestion}` : userMessage;

  emitLog(onLog, 'error', `Command failed:\n${fullMessage}`, '[Agent]');
  onStatus({ commandId, state: 'failed', error: fullMessage });
}

// ─── Helpers ────────────────────────────────────────────────────────────────



function emitLog(
  onLog: AgentLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[Agent]',
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
