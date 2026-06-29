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
import { getPage, getCdpUrl } from './browser-manager.js';
import { parseInstruction } from './instruction-parser.js';
import { getPreferredModel } from './storage.js';
import { TaskPlanner } from './task-planner.js';
import { TaskEvaluator } from './task-evaluator.js';
import { StrategyGenerator } from './strategy-generator.js';
import { ExecutionLogger } from './execution-logger.js';
import {
  StallDetector,
  createPageFingerprint,
} from './stall-detector.js';
import {
  AgentTimeoutError,
  extractError,
} from './errors.js';
import {
  runAgentCommand as runSimpleAgentCommand,
  cancelAgentCommand,
  isAgentRunning as isSimpleAgentRunning,
  setAgentPaused as setSimpleAgentPaused,
} from './agent-executor.js';
import type { AgentStatusPayload, AgentLogPayload, ApiProvider } from '../shared/types.js';

// ─── Re-export simple agent helpers so ipc-handlers only imports from here ──

export { cancelAgentCommand as cancelAgent };
export { isSimpleAgentRunning as isAgentRunning };
export { setSimpleAgentPaused as setAgentPaused };

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb    = (payload: AgentLogPayload) => void;

// ─── Configuration ───────────────────────────────────────────────────────────

const COMMAND_TIMEOUT_MS = 90_000;

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
    const msg = 'Browser is not running. Launch a browser from the Host session first.';
    emitLog(onLog, 'error', msg);
    onStatus({ commandId, state: 'failed', error: msg });
    return;
  }

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
    emitLog(onLog, 'info', 'Simple instruction detected — delegating to agent-executor.', '[AgentRunner]');
    // Delegate entirely to the robust single-command executor
    return runSimpleAgentCommand(commandId, action, instruction, apiKey, provider, onStatus, onLog);
  }

  // ── Complex pipeline ───────────────────────────────────────────────────────

  activeCommandId = commandId;
  cancelRequested = false;

  const modelName = getModelName(provider);
  emitLog(onLog, 'info', `Starting complex pipeline — model="${modelName}"`, '[AgentRunner]');
  emitLog(onLog, 'info', `Instruction: ${instruction}`, '[AgentRunner]');
  onStatus({ commandId, state: 'running' });

  const executionLogger = new ExecutionLogger(commandId, instruction);
  const taskEvaluator   = new TaskEvaluator({ strictMode: false, minConfidence: 0.6 });
  const strategyGen     = new StrategyGenerator();
  const planner         = new TaskPlanner();

  let localStagehand: Stagehand | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  let cancelIntervalId: NodeJS.Timeout | undefined;

  try {
    // ── Step 2: Plan creation ────────────────────────────────────────────────

    emitLog(onLog, 'info', 'Creating task plan...', '[AgentRunner]');
    const plan = await planner.createPlan(instruction);
    const subtasks = plan.subtasks;
    emitLog(onLog, 'info', `Plan created: ${subtasks.length} subtask(s)`, '[AgentRunner]');

    // ── Connect Stagehand ────────────────────────────────────────────────────

    emitLog(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`, '[AgentRunner]');

    localStagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: { modelName, apiKey },
      logger: (logLine: any) => {
        const level = (logLine.level || 'info') as AgentLogPayload['level'];
        const msg: string =
          logLine.message ??
          (typeof logLine === 'object' ? JSON.stringify(logLine) : String(logLine));
        emitLog(onLog, level, msg, '[Stagehand]');
      },
      verbose: 2,
    });

    emitLog(onLog, 'info', 'Initialising Stagehand...', '[AgentRunner]');
    await localStagehand.init();
    emitLog(onLog, 'info', 'Stagehand ready.', '[AgentRunner]');

    // ── Timeout + cancellation promises ──────────────────────────────────────

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

    // ── Step 3: Execute subtasks ─────────────────────────────────────────────

    const runPipeline = async () => {
      const stallDetector = new StallDetector();

      // Record initial page fingerprint
      const initFp = await createPageFingerprint(page);
      stallDetector.recordFingerprint(initFp);

      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i];

        if (cancelRequested) break;
        if (isPaused) await waitForResume(onLog);
        if (cancelRequested) break;

        // ── 3a. Log start ────────────────────────────────────────────────────
        emitLog(onLog, 'info', `[${i + 1}/${subtasks.length}] Starting: ${subtask.goal}`, '[AgentRunner]');
        planner.updateSubtaskStatus(plan, subtask.id, 'in_progress');

        // ── Execute subtask (with optional one retry on evaluation failure) ──
        let subtaskResult: any = null;
        let subtaskError: string | undefined;
        let finalInstruction = subtask.goal;

        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            // ── 3c. Parse navigation intent ──────────────────────────────────
            const parsed = await parseInstruction(finalInstruction, page.url());

            // ── 3d. Navigate if needed ───────────────────────────────────────
            if (parsed.navigationUrl) {
              emitLog(onLog, 'info', `Navigating to ${parsed.navigationUrl}`, '[AgentRunner]');
              await page.goto(parsed.navigationUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
              await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

              if (parsed.navigationOnly || !parsed.remainingAction) {
                subtaskResult = { success: true, navigatedTo: parsed.navigationUrl };
                break;
              }
            }

            const remainingAction = parsed.navigationUrl
              ? parsed.remainingAction
              : finalInstruction;

            // ── 3e. Execute action ───────────────────────────────────────────
            const pageState = {
              url: page.url(),
              title: await page.title().catch(() => ''),
              elementCount: 0,
            };

            subtaskResult = await executionLogger.logWithTiming(
              i + 1,
              subtask.action,
              remainingAction,
              async () => {
                if (subtask.action === 'extract') {
                  return await localStagehand!.extract(remainingAction, { page });
                } else if (subtask.action === 'observe') {
                  return await localStagehand!.observe(remainingAction, { page });
                } else {
                  return await localStagehand!.act(remainingAction, { page });
                }
              },
              pageState,
            );

            subtaskError = undefined;

            // ── 3f. Stall detection ──────────────────────────────────────────
            stallDetector.recordAction(subtask.action, finalInstruction);
            const currentFp = await createPageFingerprint(page);
            stallDetector.recordFingerprint(currentFp);
            const stallCheck = stallDetector.isStuck();
            if (stallCheck.stuck) {
              const nudge = stallDetector.getLoopNudgeMessage();
              emitLog(onLog, 'warn', `Stall detected: ${stallCheck.reason}`, '[AgentRunner]');
              if (nudge) emitLog(onLog, 'info', `Recovery nudge:\n${nudge}`, '[AgentRunner]');
              // Don't throw — just log and continue; let recovery handle it
            }

            // ── 3g. Evaluate (extract steps only) ────────────────────────────
            if (subtask.action === 'extract') {
              emitLog(onLog, 'info', `Evaluating extract result for subtask ${subtask.id}...`, '[AgentRunner]');
              let evaluation;
              try {
                evaluation = await taskEvaluator.evaluate(
                  subtask.goal,
                  subtaskResult,
                  { stepsExecuted: i + 1, errors: [], collectedData: {} },
                );
              } catch (evalErr) {
                emitLog(onLog, 'warn', `Evaluation failed: ${evalErr instanceof Error ? evalErr.message : String(evalErr)}`, '[AgentRunner]');
                break; // Skip recovery on evaluator crash
              }

              emitLog(
                onLog,
                evaluation.success ? 'info' : 'warn',
                `Evaluation: success=${evaluation.success} confidence=${evaluation.confidence.toFixed(2)}`,
                '[AgentRunner]',
              );

              // ── 3h. Recovery if evaluation failed ───────────────────────────
              if (!evaluation.success && attempt === 0) {
                const strategyContext = {
                  task: subtask.goal,
                  currentApproach: finalInstruction,
                  failureReason: evaluation.missingElements.join('; ') || 'low confidence',
                  stepsAttempted: i + 1,
                  stepsRemaining: subtasks.length - (i + 1),
                  pageState: {
                    url: page.url(),
                    title: await page.title().catch(() => ''),
                  },
                };

                const suggestion = await strategyGen.generateAlternatives(strategyContext);
                emitLog(onLog, 'info', `Recovery suggestion: ${suggestion.recommendation}`, '[AgentRunner]');

                // Prepend recommendation to the instruction and retry
                finalInstruction = `${suggestion.recommendation}\n\nOriginal task: ${subtask.goal}`;
                emitLog(onLog, 'info', `Retrying subtask with adjusted instruction...`, '[AgentRunner]');
                continue; // retry loop
              }
            }

            break; // success — exit retry loop

          } catch (err) {
            const errInfo = extractError(err);
            subtaskError = errInfo.message;
            emitLog(onLog, 'warn', `Subtask ${subtask.id} attempt ${attempt + 1} failed: ${subtaskError}`, '[AgentRunner]');
            if (attempt === 0 && errInfo.retryable) {
              emitLog(onLog, 'info', 'Retrying subtask once...', '[AgentRunner]');
              await sleep(1000);
              continue;
            }
            break;
          }
        } // end retry loop

        // ── 3i. Update subtask status ────────────────────────────────────────
        if (subtaskError) {
          planner.updateSubtaskStatus(plan, subtask.id, 'failed', undefined, subtaskError);
          emitLog(onLog, 'warn', `Subtask ${subtask.id} failed: ${subtaskError}`, '[AgentRunner]');
        } else {
          planner.updateSubtaskStatus(plan, subtask.id, 'completed', subtaskResult);
          emitLog(onLog, 'info', `Subtask ${subtask.id} completed.`, '[AgentRunner]');
        }

        // ── 3j. Emit progress ────────────────────────────────────────────────
        onStatus({
          commandId,
          state: 'running',
          result: { step: i + 1, total: subtasks.length },
        });
      } // end subtask loop
    };

    await Promise.race([runPipeline(), timeoutPromise, cancelPromise]);

    // ── Step 4: Completion ───────────────────────────────────────────────────

    if (cancelRequested) {
      executionLogger.cancel();
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
