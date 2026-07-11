/**
 * ExecutionEngine — Unified agent execution pipeline
 *
 * A single DynamicPlanner-driven ReAct loop handles all task complexity.
 * Lifecycle state (running / paused / cancelled) is owned by TaskSession.
 *
 * Pipeline per step:
 *   1. DynamicPlanner.getNextStep()   — decide next action
 *   2. parseInstruction()             — extract navigation intent
 *   3. page.goto() if navigation URL  — navigate first
 *   4. browser tools act/observe/extract — execute the remaining action
 *   5. StallDetector                  — flag loops
 *   6. TaskEvaluator (extract only)   — validate result quality
 *   7. StrategyGenerator (on failure) — one recovery retry per step
 *   8. ExecutionLogger                — timing tracking
 */

import type { Page } from 'playwright';
import { getBrowserPage, closeBrowser } from './browser-pool.js';
import { getPage, getCdpUrl } from '../browser-manager.js';
import { resolveModel } from './model-resolver.js';
import { ExecutionLogger } from './execution-logger.js';
import { TaskSession } from './task-session.js';
import { runToolLoop } from './agent-loop.js';
import { buildAgentSystemPrompt } from './agent-system-prompt.js';
import {
  AgentTimeoutError,
  BrowserNotReadyError,
  extractError,
} from '../errors.js';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  ApiProvider,
} from '../../shared/types.js';

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;

const COMMAND_TIMEOUT_MS = 180_000;
const MAX_STEPS = 40;

let activeSession: TaskSession | null = null;

export function isAgentRunning(): boolean {
  return activeSession?.isActive ?? false;
}

export function cancelAgent(): void {
  activeSession?.cancel();
}

export function setAgentPaused(paused: boolean): void {
  if (paused) activeSession?.pause();
  else activeSession?.resume();
}

export async function runAgent(
  commandId: string,
  _action: string,
  instruction: string,
  apiKey: string | null,
  provider: ApiProvider,
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
  variables?: Record<string, string>,
): Promise<void> {
  if (activeSession?.isActive) {
    const msg = 'Another command is already running. Cancel it first.';
    log(onLog, 'warn', msg);
    onStatus({ commandId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();

  if (!page || !cdpUrl) {
    const err = new BrowserNotReadyError(
      'Launch a browser from the Host session first.',
    );
    log(onLog, 'error', err.message);
    onStatus({ commandId, state: 'failed', error: err.message });
    return;
  }

  const session = new TaskSession({ initialGoal: instruction, variables });
  activeSession = session;
  session.start();

  log(onLog, 'info', `Starting execution pipeline via provider="${provider}"`);
  onStatus({ commandId, state: 'running' });

  const executionLogger = new ExecutionLogger(commandId, instruction);

  let localPage: Page | null = null;
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentTimeoutError(COMMAND_TIMEOUT_MS)),
        COMMAND_TIMEOUT_MS,
      );
    });

    log(onLog, 'info', 'Connecting to local browser via CDP...');

    const connectionPromise = getBrowserPage(cdpUrl, (level, msg) => {
      log(onLog, level, msg, '[Browser]');
    });

    localPage = await Promise.race([connectionPromise, timeoutPromise]);

    const cancelPromise = new Promise<never>((_, reject) => {
      if (session.abortSignal.aborted) reject(session.abortSignal.reason);
      session.abortSignal.addEventListener('abort', () => reject(session.abortSignal.reason));
    });

    const runLoop = async () => {
      return await runToolLoop({
        commandId,
        instruction,
        systemPrompt: buildAgentSystemPrompt(instruction, variables),
        page: localPage!,
        session,
        model: resolveModel(provider, apiKey),
        maxSteps: MAX_STEPS,
        onStatus,
        onLog,
      });
    };

    const loopResult = await Promise.race([runLoop(), timeoutPromise, cancelPromise]);

    if (session.isCancelled) {
      executionLogger.cancel();
      await closeBrowser().catch(() => {});
      log(onLog, 'info', 'Pipeline cancelled.');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      executionLogger.complete();
      const summary = executionLogger.getSummary() as Record<string, any>;
      summary.totalSteps = loopResult.stepCount;
      summary.successfulSteps = loopResult.stepCount;
      summary.actions = loopResult.actions;
      summary.finishReason = loopResult.finishReason;
      summary.goalAchieved = loopResult.goalAchieved;
      if (loopResult.finalMessage) {
        summary.finalMessage = loopResult.finalMessage;
      }

      log(
        onLog,
        'info',
        `Pipeline complete — ${loopResult.stepCount} tool calls, goal=${loopResult.goalAchieved}, ` +
          `duration=${(summary.totalDuration / 1000).toFixed(1)}s`,
      );
      onStatus({ commandId, state: 'completed', result: summary });
    }
  } catch (err) {
    executionLogger.fail();
    await closeBrowser().catch(() => {});
    const errInfo = extractError(err);

    if (session.isCancelled) {
      log(onLog, 'info', 'Pipeline cancelled.');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      log(onLog, 'error', `Pipeline failed: ${errInfo.message}`);
      onStatus({ commandId, state: 'failed', error: errInfo.message });
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    activeSession = null;
    localPage = null;
  }
}

function log(
  onLog: AgentLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[ExecutionEngine]',
): void {
  const line = `${prefix} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  onLog({ level, message });
}
