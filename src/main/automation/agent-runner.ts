/**
 * Agent Runner — Unified execution pipeline
 *
 * Replaces advanced-task-executor.ts and complex-task-executor.ts.
 *
 * Pipeline:
 *  1. Complexity detection  → simple tasks delegate to agent-executor directly
 *  2. Task planning         → TaskPlanner decomposes the instruction into subtasks
 *  3. Subtask execution     → Stagehand act/extract/observe per subtask
 *  4. Stall detection       → StallDetector flags loops
 *  5. Evaluation            → TaskEvaluator checks extract results
 *  6. Recovery              → StrategyGenerator proposes alternatives; one retry
 *  7. Logging               → ExecutionLogger tracks timing + costs
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
import {
  StallDetector,
  createPageFingerprint,
} from './stall-detector.js';
import {
  AgentTimeoutError,
  BrowserNotReadyError,
  extractError,
} from '../errors.js';
import {
  runAgentCommand as runSimpleAgentCommand,
  cancelAgentCommand,
  isAgentRunning as isSimpleAgentRunning,
  setAgentPaused as setSimpleAgentPaused,
} from './agent-executor.js';
import type { AgentStatusPayload, AgentLogPayload, ApiProvider } from '../../shared/types.js';

// ─── Re-export simple agent helpers so ipc-handlers only imports from here ──

export function cancelAgent(): void {
  cancelAgentCommand();
  if (activeCommandId !== null) {
    cancelRequested = true;
  }
}

export function isAgentRunning(): boolean {
  return isSimpleAgentRunning() || activeCommandId !== null;
}

export function setAgentPaused(paused: boolean): void {
  setSimpleAgentPaused(paused);
  isPaused = paused;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb    = (payload: AgentLogPayload) => void;

// ─── Configuration ───────────────────────────────────────────────────────────

const COMMAND_TIMEOUT_MS = 180_000; // 3 minutes — Stagehand init + LLM calls can be slow

/** Keywords that indicate a multi-step / complex request */
const MULTI_STEP_KEYWORDS = [
  'then', 'and', 'after', 'next', 'also', 'finally',
  'first', 'second', 'third', 'step', 'steps',
  'find', 'search', 'extract', 'collect', 'navigate',
  'visit', 'go to', 'open', 'browse',
];

// ─── Module-level state ──────────────────────────────────────────────────────

let activeCommandId: string | null = null;
let cancelRequested = false;
let isPaused = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitLog(
  onLog: AgentLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[AgentRunner]',
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



function isSimpleInstruction(instruction: string): boolean {
  if (instruction.length >= 50) return false;
  const lower = instruction.toLowerCase();
  return !MULTI_STEP_KEYWORDS.some((kw) => lower.includes(kw));
}

async function waitForResume(onLog: AgentLogCb): Promise<void> {
  if (!isPaused) return;
  emitLog(onLog, 'info', 'Agent paused for manual takeover. Waiting for resume...');
  while (isPaused && !cancelRequested) {
    await sleep(500);
  }
  if (!cancelRequested) {
    emitLog(onLog, 'info', 'Agent resumed. Continuing pipeline...');
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run an agent command through the unified pipeline.
 *
 * Simple instructions are forwarded to agent-executor (runAgentCommand).
 * Complex instructions go through the full planning → execution → evaluation
 * → recovery pipeline.
 */
export async function runAgent(
  commandId: string,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  apiKey: string,
  provider: ApiProvider,
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
): Promise<void> {
  // Guard: only one command at a time
  if (activeCommandId !== null || isSimpleAgentRunning()) {
    const msg = `Another command is already running. Cancel it first.`;
    emitLog(onLog, 'warn', msg);
    onStatus({ commandId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();

  if (!page || !cdpUrl) {
    const err = new BrowserNotReadyError('Launch a browser from the Host session first.');
    emitLog(onLog, 'error', err.message);
    onStatus({ commandId, state: 'failed', error: err.message });
    return;
  }

  activeCommandId = commandId;
  cancelRequested = false;

  // ── Step 1: Complexity detection ──────────────────────────────────────────

  // Parse for navigation intent (quick check, reused below for the first subtask)
  let parsedTop;
  try {
    parsedTop = await parseInstruction(instruction, page.url());
  } catch (_err) {
    parsedTop = null;
  }

  const hasNavigation = parsedTop?.navigationUrl != null;
  const simple = !hasNavigation && isSimpleInstruction(instruction);

  if (simple) {
    activeCommandId = null;
    emitLog(onLog, 'info', 'Simple instruction detected — delegating to agent-executor.', '[AgentRunner]');
    // Delegate entirely to the robust single-command executor
    return runSimpleAgentCommand(commandId, action, instruction, apiKey, provider, onStatus, onLog);
  }

  // ── Complex pipeline ───────────────────────────────────────────────────────

  const stagehandConfig = getStagehandModelConfig(provider, apiKey);
  emitLog(onLog, 'info', `Starting complex pipeline — model="${stagehandConfig.modelName}"`, '[AgentRunner]');
  onStatus({ commandId, state: 'running' });

  const executionLogger = new ExecutionLogger(commandId, instruction);
  const taskEvaluator   = new TaskEvaluator({ strictMode: false, minConfidence: 0.6 });
  const strategyGen     = new StrategyGenerator();
  const dynamicPlanner  = new DynamicPlanner();

  let localStagehand: Stagehand | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  let cancelIntervalId: NodeJS.Timeout | undefined;

  try {
    // ── Connect Stagehand ────────────────────────────────────────────────────

    emitLog(onLog, 'info', 'Connecting to local browser via CDP...', '[AgentRunner]');

    localStagehand = await getStagehand(cdpUrl, stagehandConfig, (level, msg) => {
      emitLog(onLog, level, msg, '[Stagehand]');
    });

    // ── Timeout + cancellation promises ─────────────────────────────────────
    // Start the clock AFTER init so slow model cold-starts don't burn the budget.

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentTimeoutError(COMMAND_TIMEOUT_MS)),
        COMMAND_TIMEOUT_MS,
      );
    });

    const cancelPromise = new Promise<never>((_, reject) => {
      cancelIntervalId = setInterval(() => {
        if (cancelRequested) reject(new Error('Cancelled by user'));
      }, 200);
    });

    // ── Step 3: Execute via Dynamic Goal Refinement ──────────────────────────
    // After init(), Stagehand has connected to the CDP browser and manages its own
    // Playwright context. We MUST use its active page for act/extract/observe — 
    // passing the browser-manager's page causes silent hangs (different Playwright instances).
    const stagehandPages = await localStagehand.context.pages();
    const activePage = stagehandPages[0] ?? page; // fallback to browser-manager page

    const runPipeline = async () => {
      const stallDetector = new StallDetector();
      const scratchpad: string[] = [];
      let goalAchieved = false;
      let stepCount = 0;
      const MAX_STEPS = 25;

      // Record initial page fingerprint (use activePage for Playwright ops)
      const initFp = await createPageFingerprint(activePage as any);
      stallDetector.recordFingerprint(initFp);

      while (!goalAchieved && stepCount < MAX_STEPS) {
        if (cancelRequested) break;
        if (isPaused) await waitForResume(onLog);
        if (cancelRequested) break;

        stepCount++;

        // ── 3a. Get next step from DynamicPlanner ────────────────────────────
        emitLog(onLog, 'info', `[Step ${stepCount}] Asking Dynamic Planner for next move...`, '[AgentRunner]');
        
        const pageState = {
          url: activePage.url(),
          title: await activePage.title().catch(() => ''),
          elementCount: await activePage.locator('button, input, select, a, [role="button"]').count().catch(() => 0),
        };

        const nextStep = await dynamicPlanner.getNextStep(instruction, scratchpad, pageState);

        if (nextStep.is_goal_achieved) {
          emitLog(onLog, 'info', `[Step ${stepCount}] Planner reports goal achieved! Thought: ${nextStep.thought}`, '[AgentRunner]');
          goalAchieved = true;
          break;
        }

        emitLog(onLog, 'info', `[Step ${stepCount}] Thought: ${nextStep.thought}`, '[AgentRunner]');
        emitLog(onLog, 'info', `[Step ${stepCount}] Action: ${nextStep.action} "${nextStep.instruction}"`, '[AgentRunner]');

        // ── Execute step (with optional one retry on evaluation failure) ──
        let subtaskResult: any = null;
        let subtaskError: string | undefined;
        let finalInstruction = nextStep.instruction;

        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            // ── 3c. Parse navigation intent ──────────────────────────────────
            const parsed = await parseInstruction(finalInstruction, activePage.url());

            // ── 3d. Navigate if needed ───────────────────────────────────────
            if (parsed.navigationUrl) {
              emitLog(onLog, 'info', `Navigating to ${parsed.navigationUrl}`, '[AgentRunner]');
              await activePage.goto(parsed.navigationUrl, { waitUntil: 'domcontentloaded', timeoutMs: 15_000 });
              await activePage.waitForLoadState('networkidle', 10_000).catch(() => {});

              if (parsed.navigationOnly || !parsed.remainingAction) {
                subtaskResult = { success: true, navigatedTo: parsed.navigationUrl };
                break;
              }
            }

            const remainingAction = parsed.navigationUrl
              ? parsed.remainingAction
              : finalInstruction;

            // ── 3e. Execute action ───────────────────────────────────────────
            subtaskResult = await executionLogger.logWithTiming(
              stepCount,
              nextStep.action,
              remainingAction,
              async () => {
                if (nextStep.action === 'extract') {
                  return await localStagehand!.extract(remainingAction, { page: activePage });
                } else if (nextStep.action === 'observe') {
                  return await localStagehand!.observe(remainingAction, { page: activePage });
                } else {
                  return await localStagehand!.act(remainingAction, { page: activePage });
                }
              },
              pageState,
            );

            subtaskError = undefined;

            // ── 3f. Stall detection ──────────────────────────────────────────
            stallDetector.recordAction(nextStep.action, finalInstruction);
            const currentFp = await createPageFingerprint(activePage as any);
            stallDetector.recordFingerprint(currentFp);
            const stallCheck = stallDetector.isStuck();
            if (stallCheck.stuck) {
              const nudge = stallDetector.getLoopNudgeMessage();
              emitLog(onLog, 'warn', `Stall detected: ${stallCheck.reason}`, '[AgentRunner]');
              if (nudge) {
                emitLog(onLog, 'info', `Recovery nudge:\n${nudge}`, '[AgentRunner]');
                scratchpad.push(`STALL WARNING: ${stallCheck.reason}. Nudge: ${nudge}`);
              }
            }

            // ── 3g. Evaluate (extract steps only) ────────────────────────────
            if (nextStep.action === 'extract') {
              emitLog(onLog, 'info', `Evaluating extract result for step ${stepCount}...`, '[AgentRunner]');
              let evaluation;
              try {
                evaluation = await taskEvaluator.evaluate(
                  nextStep.instruction,
                  subtaskResult,
                  { stepsExecuted: stepCount, errors: [], collectedData: {} },
                );
              } catch (evalErr) {
                const msg = evalErr instanceof Error ? evalErr.message : String(evalErr);
                emitLog(onLog, 'warn', `Evaluation failed: ${msg}`, '[AgentRunner]');
                subtaskError = `Evaluation error: ${msg}`;
                subtaskResult = null;
                break; // Skip recovery on evaluator crash
              }

              emitLog(
                onLog,
                evaluation.success ? 'info' : 'warn',
                `Evaluation: success=${evaluation.success} confidence=${evaluation.confidence.toFixed(2)}`,
                '[AgentRunner]',
              );

              // ── 3h. Recovery if evaluation failed ───────────────────────────
              if (!evaluation.success) {
                if (attempt === 0) {
                  const strategyContext = {
                    task: nextStep.instruction,
                    currentApproach: finalInstruction,
                    failureReason: evaluation.missingElements.join('; ') || 'low confidence',
                    stepsAttempted: stepCount,
                    stepsRemaining: MAX_STEPS - stepCount,
                    pageState: {
                      url: activePage.url(),
                      title: await activePage.title().catch(() => ''),
                    },
                  };

                  const suggestion = await strategyGen.generateAlternatives(strategyContext);
                  emitLog(onLog, 'info', `Recovery suggestion: ${suggestion.recommendation}`, '[AgentRunner]');

                  // Prepend recommendation to the instruction and retry
                  finalInstruction = `${suggestion.recommendation}\n\nOriginal task: ${nextStep.instruction}`;
                  emitLog(onLog, 'info', `Retrying step with adjusted instruction...`, '[AgentRunner]');
                  continue; // retry loop
                } else {
                  subtaskError = `Extraction evaluation failed: ${evaluation.missingElements.join('; ') || 'low confidence'}`;
                  subtaskResult = null;
                }
              }
            }

            break; // success — exit retry loop

          } catch (err) {
            const errInfo = extractError(err);
            subtaskError = errInfo.message;
            emitLog(onLog, 'warn', `Step ${stepCount} attempt ${attempt + 1} failed: ${subtaskError}`, '[AgentRunner]');
            if (attempt === 0 && errInfo.retryable) {
              emitLog(onLog, 'info', 'Retrying step once...', '[AgentRunner]');
              await sleep(1000);
              continue;
            }
            break;
          }
        } // end retry loop

        // ── 3i. Update Scratchpad ────────────────────────────────────────────
        if (subtaskError) {
          scratchpad.push(`Failed to execute: [${nextStep.action}] "${nextStep.instruction}". Error: ${subtaskError}`);
        } else {
          scratchpad.push(`Successfully executed: [${nextStep.action}] "${nextStep.instruction}"`);
          if (nextStep.action === 'extract') {
            scratchpad.push(`Extracted data snippet: ${JSON.stringify(subtaskResult).slice(0, 150)}...`);
          }
        }

        // ── 3j. Emit progress ────────────────────────────────────────────────
        onStatus({
          commandId,
          state: 'running',
          result: { step: stepCount, latestAction: nextStep.instruction },
        });
      } // end subtask loop

      if (!goalAchieved && stepCount >= MAX_STEPS) {
        throw new Error('Maximum steps reached without achieving goal.');
      }
    };

    await Promise.race([runPipeline(), timeoutPromise, cancelPromise]);

    // ── Step 4: Completion ───────────────────────────────────────────────────

    if (cancelRequested) {
      executionLogger.cancel();
      await closeStagehand().catch(() => {});
      emitLog(onLog, 'info', 'Pipeline cancelled.', '[AgentRunner]');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      executionLogger.complete();
      const summary = executionLogger.getSummary();
      emitLog(
        onLog,
        'info',
        `Pipeline complete — ${summary.successfulSteps}/${summary.totalSteps} subtasks succeeded, ` +
        `duration=${(summary.totalDuration / 1000).toFixed(1)}s`,
        '[AgentRunner]',
      );
      onStatus({ commandId, state: 'completed', result: summary });
    }

  } catch (err) {
    executionLogger.fail();
    await closeStagehand().catch(() => {});
    const errInfo = extractError(err);

    if (cancelRequested) {
      emitLog(onLog, 'info', 'Pipeline cancelled.', '[AgentRunner]');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      emitLog(onLog, 'error', `Pipeline failed: ${errInfo.message}`, '[AgentRunner]');
      onStatus({ commandId, state: 'failed', error: errInfo.message });
    }
  } finally {
    clearTimeout(timeoutId);
    clearInterval(cancelIntervalId);
    activeCommandId = null;
    cancelRequested = false;
    localStagehand = null;
  }
}
