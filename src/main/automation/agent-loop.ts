/**
 * @file agent-loop.ts
 * @description Single-turn and multi-turn autonomous tool-calling execution loops implemented via the Vercel AI SDK v5.
 * Key Exported APIs: `runToolLoop` function, `AgentLoopResult` interface, and `AgentLoopOptions` configuration options.
 * Internal Mechanics: Coordinates task execution with custom browser tools. Generates LLM calls with target system prompts, processes output streams, intercepts step completion metrics, maps tool actions (Goto, Act, Observe, Extract) to execution steps, and formats human-readable status events.
 * Recording & State: Encodes executed actions to workflow-mappable commands, logs snapshots sequentially to `TaskSession` journals, and pushes status updates back to renderer callers via callback streams.
 */

import { generateText } from 'ai';
import type { Page } from 'playwright';
import { createBrowserTools } from './agent-tools.js';
import { formatToolAction } from './agent-trace.js';
import { mapAgentToolToWorkflowStep } from './workflow-step-mapper.js';
import type { AgentLogCb, AgentStatusCb } from './execution-engine.js';
import type { TaskSession } from './task-session.js';
import type { ExecutionTraceEntry, RecordedAgentStep, WorkflowStep } from '../../shared/types.js';
import { randomUUID } from 'crypto';
import type { AutomationSecurityMode } from './security-mode.js';
import { buildAgentTaskPrompt } from './agent-system-prompt.js';
import { createDevelopmentLogger } from '../dev-logger.js';

export type AgentTerminationReason = 'done_true' | 'done_false' | 'max_steps' | 'model_text' | 'stopped_without_done';

const terminalLog = createDevelopmentLogger('AgentLoop');

export interface AgentLoopResult {
  goalAchieved: boolean;
  /** A plain-language response that intentionally did not need browser actions. */
  isConversationalResponse: boolean;
  finishReason: string;
  terminationReason: AgentTerminationReason;
  stepCount: number;
  actions: string[];
  finalMessage?: string;
  /** Legacy structured tool call data */
  recordedSteps: RecordedAgentStep[];
  executionTrace: ExecutionTraceEntry[];
}

export interface AgentLoopOptions {
  commandId: string;
  instruction: string;
  systemPrompt: string;
  page: Page;
  session: TaskSession;
  model: any;
  maxSteps: number;
  /** Explicit security mode for this run. */
  securityMode?: AutomationSecurityMode;
  /** Legacy compatibility for internal callers; prefer securityMode. */
  enforceScope?: boolean;
  onStatus?: AgentStatusCb;
  onLog: AgentLogCb;
  onRecordStep?: (step: WorkflowStep) => void;
}

export async function runToolLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    commandId,
    instruction,
    systemPrompt,
    page,
    session,
    model,
    maxSteps,
    securityMode: requestedSecurityMode,
    enforceScope,
    onStatus,
    onLog,
    onRecordStep,
  } = opts;

  const securityMode: AutomationSecurityMode = requestedSecurityMode
    ?? (enforceScope === false ? 'local' : 'policy-enforced');

  const actions: string[] = [];
  const recordedSteps: RecordedAgentStep[] = [];
  const executionTrace: ExecutionTraceEntry[] = [];
  let lastKnownUrl = page.url();
  let doneSignal: boolean | undefined;
  const toolStartedAt = new Map<string, number>();

  terminalLog.info('run.start', {
    commandId,
    securityMode,
    maxSteps,
    url: page.url(),
    hasHistoryPrompt: instruction.startsWith('<historical_context'),
  });
  
  if (actions.length === 0 && session.journal) {
    await session.journal.recordUserMessage(instruction);
  }

  const tools = createBrowserTools(page, () => ({
    taskId: commandId,
    step: actions.length + 1,
    taskProgress: `Step ${actions.length + 1} of agent run`,
    abortSignal: session.abortSignal,
  }), securityMode, (toolName, input) => {
    if (['think', 'notifyUser', 'done'].includes(toolName)) return;
    toolStartedAt.set(toolName, Date.now());
    terminalLog.info('tool.start', {
      commandId,
      tool: toolName,
      action: formatToolAction(toolName, input),
    });
    onLog({ level: 'info', message: formatToolAction(toolName, input), phase: 'started' });
  });
  let goalAchieved = false;
  let taskTerminated = false;
  let finalMessage: string | undefined;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: instruction.startsWith('<current_user_request') || instruction.startsWith('<historical_context')
      ? instruction
      : buildAgentTaskPrompt(instruction),
    tools,
    toolChoice: 'auto',
    stopWhen: ({ steps }: any) => session.isCancelled || taskTerminated || steps.length >= maxSteps,
    abortSignal: session.abortSignal,

    onStepFinish: async (event) => {
      if (session.isCancelled) return;
      const stepNum = actions.length + 1;
      const hasDone = event.toolCalls?.some((tc: any) => tc.toolName === 'done');
      const hasToolCalls = (event.toolCalls?.length ?? 0) > 0;

      terminalLog.info('model.step', {
        commandId,
        step: stepNum,
        finishReason: String((event as any).finishReason ?? 'unknown'),
        tools: (event.toolCalls ?? []).map((tc: any) => tc.toolName),
        hasText: Boolean(event.text?.trim()),
      });

      if (event.text && event.text.trim()) {
        const trimmed = event.text.trim();
        if (!hasToolCalls && !hasDone) {
          // Model outputted final answer directly without calling tools
          finalMessage = trimmed;
        } else if (!hasDone && !trimmed.startsWith('{') && !trimmed.startsWith('["') && !trimmed.startsWith('```json')) {
          onLog({ level: 'info', message: trimmed });
        }
      }

      for (const tc of event.toolCalls ?? []) {
        // AI SDK v5: tool call args are at tc.input (not tc.args)
        const input = (tc as any).input ?? {};
        // AI SDK v5: tool result output is at tr.output (not tr.result)
        const toolOutput = (event.toolResults?.find((tr: any) => tr.toolCallId === tc.toolCallId) as any)?.output;

        const actionsToProcess = [];
        if (tc.toolName === 'runActionSequence' && Array.isArray(input.actions)) {
          // runActionSequence returns { success, results: [{tool, result}] }
          input.actions.forEach((actData: any, i: number) => {
            actionsToProcess.push({
              toolName: actData.toolName,
              input: actData.args ?? {},
              result: toolOutput?.results?.[i]?.result,
            });
          });
        } else {
          actionsToProcess.push({
            toolName: tc.toolName,
            input,
            result: toolOutput,
          });
        }

        for (const actionInfo of actionsToProcess) {
          const traceId = randomUUID();
          const startedAt = toolStartedAt.get(actionInfo.toolName);
          toolStartedAt.delete(actionInfo.toolName);
          if (actionInfo.result?.blockedByPolicy) {
            const blockedSummary = `Blocked by task scope: ${actionInfo.result.reason || actionInfo.toolName}`;
            onLog({ level: 'warn', message: blockedSummary });
            actions.push(blockedSummary);
            executionTrace.push({
              id: traceId, sequence: executionTrace.length + 1, timestamp: Date.now(), tool: actionInfo.toolName,
              input: { ...actionInfo.input }, semanticDescription: blockedSummary, status: 'blocked',
              urlBefore: lastKnownUrl, urlAfter: lastKnownUrl, error: actionInfo.result.reason,
            });
            terminalLog.warn('tool.result', {
              commandId,
              tool: actionInfo.toolName,
              status: 'blocked',
              step: stepNum,
              durationMs: startedAt ? Date.now() - startedAt : undefined,
            });
            continue;
          }

          const finalInput = { ...actionInfo.input };
          if (actionInfo.toolName === 'act' && actionInfo.input.index !== undefined) {
            if (actionInfo.result?.resolvedSelector) {
              finalInput.selector = actionInfo.result.resolvedSelector;
              terminalLog.debug('selector.resolved', {
                commandId,
                index: actionInfo.input.index,
                selector: finalInput.selector,
              });
            } else {
              terminalLog.warn('selector.unresolved', {
                commandId,
                index: actionInfo.input.index,
                workflowRecording: 'skipped',
              });
            }
          }
          
          const urlAfter = actionInfo.result?.url || page.url();
          const cleanSummary = formatToolAction(actionInfo.toolName, finalInput);
          const toolStatus = actionInfo.result?.success === false ? 'failed' : 'succeeded';
          terminalLog.info('tool.result', {
            commandId,
            tool: actionInfo.toolName,
            status: toolStatus,
            step: stepNum,
            durationMs: startedAt ? Date.now() - startedAt : undefined,
            action: cleanSummary,
          });
          onLog({ level: 'info', message: cleanSummary, phase: actionInfo.result?.success === false ? 'failed' : 'completed' });
          actions.push(cleanSummary);

          if (!['think', 'notifyUser', 'done', 'askUser', 'wait'].includes(actionInfo.toolName)) {
            executionTrace.push({
              id: traceId,
              sequence: executionTrace.length + 1,
              timestamp: Date.now(),
              tool: actionInfo.toolName,
              input: finalInput,
              semanticDescription: cleanSummary,
              status: actionInfo.result?.success === false ? 'failed' : 'succeeded',
              resolvedSelector: actionInfo.result?.resolvedSelector,
              targetLabel: actionInfo.result?.targetLabel,
              urlBefore: lastKnownUrl,
              urlAfter,
              error: actionInfo.result?.error,
            });
            lastKnownUrl = urlAfter;
          }
          
          if (!['think', 'notifyUser', 'done', 'askUser', 'wait'].includes(actionInfo.toolName)) {
            recordedSteps.push({ tool: actionInfo.toolName, summary: cleanSummary, input: finalInput });
            
            const snapshotId = session.journal
              ? await session.journal.recordAgentStep(actionInfo.toolName, finalInput, actionInfo.result, cleanSummary)
              : randomUUID();
            
            if (onRecordStep) {
              const workflowStep = mapAgentToolToWorkflowStep({
                id: snapshotId,
                toolName: actionInfo.toolName,
                input: finalInput,
                summary: cleanSummary,
              });
              
              if (workflowStep) {
                onRecordStep(workflowStep);
              } else {
                onLog({ level: 'warn', message: `Skipped recording step for ${actionInfo.toolName} (no mapped selector/action)` });
              }
            }
          }
          if (actionInfo.toolName === 'done') {
            goalAchieved = finalInput.taskComplete === true;
            doneSignal = goalAchieved;
            taskTerminated = true;
            finalMessage = finalInput.message || (goalAchieved ? 'Task completed.' : 'Task could not be completed.');
            terminalLog.info('completion.signal', {
              commandId,
              taskComplete: goalAchieved,
              messageLength: typeof finalInput.message === 'string' ? finalInput.message.length : 0,
            });
          }
        }
      }

      onStatus?.({
        commandId,
        state: 'running',
        result: { step: stepNum, latestAction: actions.at(-1) ?? '' },
      });
    },
  });

  const readOnlyTools = new Set(['observe', 'extract', 'getPageUrl']);
  const isConversationalResponse = !goalAchieved
    && Boolean(finalMessage?.trim())
    && executionTrace.every((entry) => readOnlyTools.has(entry.tool));
  const stepCount = result.steps?.length ?? actions.length;
  const terminationReason: AgentTerminationReason = goalAchieved
    ? 'done_true'
    : doneSignal === false
      ? 'done_false'
      : isConversationalResponse
        ? 'model_text'
        : stepCount >= maxSteps
          ? 'max_steps'
          : 'stopped_without_done';

  terminalLog[terminationReason === 'done_true' || terminationReason === 'model_text' ? 'info' : 'warn']('run.stop', {
    commandId,
    terminationReason,
    finishReason: result.finishReason,
    stepCount,
    toolCount: actions.length,
    doneSignal: doneSignal === undefined ? 'missing' : doneSignal,
    finalMessageLength: finalMessage?.length ?? 0,
  });

  return {
    goalAchieved,
    isConversationalResponse,
    finishReason: result.finishReason,
    stepCount,
    actions,
    finalMessage,
    terminationReason,
    recordedSteps,
    executionTrace,
  };
}
