/**
 * ExecutionEngine — Unified agent execution pipeline
 *
 * A single DynamicPlanner-driven ReAct loop handles all task complexity.
 * Lifecycle state (running / paused / cancelled) is owned by TaskSession,
 * not scattered as module-level booleans.
 *
 * Pipeline per step:
 *   1. DynamicPlanner.getNextStep()   — decide next action
 *   2. parseInstruction()             — extract navigation intent
 *   3. page.goto() if navigation URL  — navigate first
 *   4. stagehand.act/observe/extract  — execute the remaining action
 *   5. StallDetector                  — flag loops
 *   6. TaskEvaluator (extract only)   — validate result quality
 *   7. StrategyGenerator (on failure) — one recovery retry per step
 *   8. ExecutionLogger                — timing tracking
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { getStagehand, closeStagehand } from './stagehand-pool.js';
import { getPage, getCdpUrl } from '../browser-manager.js';
import { parseInstruction } from './instruction-parser.js';
import { getStagehandModelConfig } from './model-resolver.js';
import { DynamicPlanner } from './task-planner.js';
import { TaskEvaluator } from './task-evaluator.js';
import { StrategyGenerator } from './strategy-generator.js';
import { ExecutionLogger } from './execution-logger.js';
import { StallDetector, createPageFingerprint } from './stall-detector.js';
import { TaskSession } from './task-session.js';
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

// ─── Public callback types ────────────────────────────────────────────────────

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;

// ─── Configuration ────────────────────────────────────────────────────────────

/** 3 minutes — Stagehand init + LLM calls can be slow */
const COMMAND_TIMEOUT_MS = 180_000;
const MAX_STEPS = 25;

// ─── Module-level session ─────────────────────────────────────────────────────
// One session at a time. Public helpers below delegate to it.

let activeSession: TaskSession | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

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

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runAgent(
  commandId: string,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  apiKey: string,
  provider: ApiProvider,
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
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

  const session = new TaskSession();
  activeSession = session;
  session.start();

  const stagehandConfig = getStagehandModelConfig(provider, apiKey);
  log(onLog, 'info', `Starting — model="${stagehandConfig.modelName}"`);
  onStatus({ commandId, state: 'running' });

  const executionLogger = new ExecutionLogger(commandId, instruction);
  const taskEvaluator = new TaskEvaluator({ strictMode: false, minConfidence: 0.6 });
  const strategyGen = new StrategyGenerator();
  const dynamicPlanner = new DynamicPlanner();

  let localStagehand: Stagehand | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  let cancelIntervalId: NodeJS.Timeout | undefined;

  try {
    // Start clock BEFORE init so slow cold-starts or connection hangs don't wedge us.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentTimeoutError(COMMAND_TIMEOUT_MS)),
        COMMAND_TIMEOUT_MS,
      );
    });

    log(onLog, 'info', 'Connecting to local browser via CDP...');

    const connectionPromise = getStagehand(cdpUrl, stagehandConfig, (level, msg) => {
      log(onLog, level, msg, '[Stagehand]');
    });

    localStagehand = await Promise.race([connectionPromise, timeoutPromise]);

    // Stagehand manages its own Playwright context — use its active page for
    // act/extract/observe to avoid silent hangs from mixing Playwright instances.
    const stagehandPages = await localStagehand.context.pages();
    const activePage = stagehandPages[0] ?? page;

    const cancelPromise = new Promise<never>((_, reject) => {
      cancelIntervalId = setInterval(() => {
        if (session.isCancelled) reject(new Error('Cancelled by user'));
      }, 200);
    });

    // ── ReAct loop ────────────────────────────────────────────────────────────
    const runLoop = async () => {
      const stallDetector = new StallDetector();
      const scratchpad: string[] = [];
      let goalAchieved = false;
      let stepCount = 0;

      const initFp = await createPageFingerprint(activePage as any);
      stallDetector.recordFingerprint(initFp);

      while (!goalAchieved && stepCount < MAX_STEPS) {
        if (session.isCancelled) break;

        await session.waitIfPaused(
          () => log(onLog, 'info', 'Paused for manual takeover. Waiting for resume...'),
          () => log(onLog, 'info', 'Resumed. Continuing pipeline...'),
        );

        if (session.isCancelled) break;

        stepCount++;

        // ── 1. Ask the planner for the next move ─────────────────────────────
        log(onLog, 'info', `[Step ${stepCount}] Asking planner for next move...`);

        const pageState = {
          url: activePage.url(),
          title: await activePage.title().catch(() => ''),
          elementCount: await activePage
            .locator('button, input, select, a, [role="button"]')
            .count()
            .catch(() => 0),
        };

        const nextStep = await dynamicPlanner.getNextStep(
          instruction,
          scratchpad,
          pageState,
        );

        if (nextStep.is_goal_achieved) {
          log(onLog, 'info', `[Step ${stepCount}] Planner: goal achieved. ${nextStep.thought}`);
          goalAchieved = true;
          break;
        }

        log(onLog, 'info', `[Step ${stepCount}] Thought: ${nextStep.thought}`);
        log(onLog, 'info', `[Step ${stepCount}] Action: ${nextStep.action} "${nextStep.instruction}"`);

        // Honour the IPC-level `action` on step 1 if the planner agrees;
        // otherwise defer to the planner's judgement for all subsequent steps.
        const stepAction =
          stepCount === 1
            ? nextStep.action === action
              ? action
              : nextStep.action
            : nextStep.action;

        // ── 2–7. Navigation + execution (with one recovery retry) ─────────────
        let subtaskResult: unknown = null;
        let subtaskError: string | undefined;
        let finalInstruction = nextStep.instruction;

        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            // ── 2. Parse navigation intent ────────────────────────────────────
            const parsed = await parseInstruction(finalInstruction, activePage.url());

            // ── 3. Navigate if a URL was detected ─────────────────────────────
            if (parsed.navigationUrl) {
              log(onLog, 'info', `Navigating to ${parsed.navigationUrl}`);
              await activePage.goto(parsed.navigationUrl, {
                waitUntil: 'domcontentloaded',
                timeoutMs: 15_000,
              });
              await activePage
                .waitForLoadState('networkidle', 10_000)
                .catch(() => {});

              if (parsed.navigationOnly || !parsed.remainingAction) {
                subtaskResult = { success: true, navigatedTo: parsed.navigationUrl };
                break;
              }
            }

            const actionInstruction = parsed.navigationUrl
              ? parsed.remainingAction
              : finalInstruction;

            // ── 4. Execute the action ─────────────────────────────────────────
            subtaskResult = await executionLogger.logWithTiming(
              stepCount,
              stepAction,
              actionInstruction,
              async () => {
                if (stepAction === 'extract') {
                  return await localStagehand!.extract(actionInstruction, {
                    page: activePage,
                  });
                } else if (stepAction === 'observe') {
                  return await localStagehand!.observe(actionInstruction, {
                    page: activePage,
                  });
                } else {
                  return await localStagehand!.act(actionInstruction, {
                    page: activePage,
                  });
                }
              },
              pageState,
            );

            subtaskError = undefined;

            // ── 5. Stall detection ────────────────────────────────────────────
            stallDetector.recordAction(stepAction, finalInstruction);
            const currentFp = await createPageFingerprint(activePage as any);
            stallDetector.recordFingerprint(currentFp);
            const stallCheck = stallDetector.isStuck();
            if (stallCheck.stuck) {
              const nudge = stallDetector.getLoopNudgeMessage();
              log(onLog, 'warn', `Stall detected: ${stallCheck.reason}`);
              if (nudge) {
                log(onLog, 'info', `Recovery nudge:\n${nudge}`);
                scratchpad.push(`STALL WARNING: ${stallCheck.reason}. Nudge: ${nudge}`);
              }
            }

            // ── 6. Evaluate extract results ───────────────────────────────────
            if (stepAction === 'extract') {
              log(onLog, 'info', `Evaluating extract result for step ${stepCount}...`);
              let evaluation;
              try {
                evaluation = await taskEvaluator.evaluate(
                  nextStep.instruction,
                  subtaskResult,
                  { stepsExecuted: stepCount, errors: [], collectedData: {} },
                );
              } catch (evalErr) {
                const msg = evalErr instanceof Error ? evalErr.message : String(evalErr);
                log(onLog, 'warn', `Evaluation failed: ${msg}`);
                break;
              }

              log(
                onLog,
                evaluation.success ? 'info' : 'warn',
                `Evaluation: success=${evaluation.success} confidence=${evaluation.confidence.toFixed(2)}`,
              );

              // ── 7. Recovery on failed evaluation (one retry) ──────────────
              if (!evaluation.success && attempt === 0) {
                const suggestion = await strategyGen.generateAlternatives({
                  task: nextStep.instruction,
                  currentApproach: finalInstruction,
                  failureReason:
                    evaluation.missingElements.join('; ') || 'low confidence',
                  stepsAttempted: stepCount,
                  stepsRemaining: MAX_STEPS - stepCount,
                  pageState: {
                    url: activePage.url(),
                    title: await activePage.title().catch(() => ''),
                  },
                });
                log(onLog, 'info', `Recovery suggestion: ${suggestion.recommendation}`);
                finalInstruction = `${suggestion.recommendation}\n\nOriginal task: ${nextStep.instruction}`;
                log(onLog, 'info', 'Retrying step with adjusted instruction...');
                continue;
              } else if (!evaluation.success) {
                subtaskError = `Extraction evaluation failed: ${
                  evaluation.missingElements.join('; ') || 'low confidence'
                }`;
                subtaskResult = null;
              }
            }

            break; // success — exit retry loop

          } catch (err) {
            const errInfo = extractError(err);
            subtaskError = errInfo.message;
            log(
              onLog,
              'warn',
              `Step ${stepCount} attempt ${attempt + 1} failed: ${subtaskError}`,
            );
            if (attempt === 0 && errInfo.retryable) {
              log(onLog, 'info', 'Retrying step once...');
              await sleep(1_000);
              continue;
            }
            break;
          }
        } // end retry loop

        // ── 8. Update scratchpad and emit progress ────────────────────────────
        if (subtaskError) {
          scratchpad.push(
            `Failed to execute: [${stepAction}] "${nextStep.instruction}". Error: ${subtaskError}`,
          );
        } else {
          scratchpad.push(
            `Successfully executed: [${stepAction}] "${nextStep.instruction}"`,
          );
          if (stepAction === 'extract') {
            scratchpad.push(
              `Extracted data snippet: ${JSON.stringify(subtaskResult).slice(0, 150)}...`,
            );
          }
        }

        onStatus({
          commandId,
          state: 'running',
          result: { step: stepCount, latestAction: nextStep.instruction },
        });
      } // end ReAct loop

      if (!goalAchieved && stepCount >= MAX_STEPS) {
        throw new Error('Maximum steps reached without achieving goal.');
      }
    };

    await Promise.race([runLoop(), timeoutPromise, cancelPromise]);

    if (session.isCancelled) {
      executionLogger.cancel();
      await closeStagehand().catch(() => {});
      log(onLog, 'info', 'Pipeline cancelled.');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      executionLogger.complete();
      const summary = executionLogger.getSummary();
      log(
        onLog,
        'info',
        `Pipeline complete — ${summary.successfulSteps}/${summary.totalSteps} steps succeeded, ` +
          `duration=${(summary.totalDuration / 1000).toFixed(1)}s`,
      );
      onStatus({ commandId, state: 'completed', result: summary });
    }
  } catch (err) {
    executionLogger.fail();
    await closeStagehand().catch(() => {});
    const errInfo = extractError(err);

    if (session.isCancelled) {
      log(onLog, 'info', 'Pipeline cancelled.');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      log(onLog, 'error', `Pipeline failed: ${errInfo.message}`);
      onStatus({ commandId, state: 'failed', error: errInfo.message });
    }
  } finally {
    clearTimeout(timeoutId);
    clearInterval(cancelIntervalId);
    activeSession = null;
    localStagehand = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
