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
import type { AgentLogCb, AgentStatusCb } from './execution-engine.js';
import type { TaskSession } from './task-session.js';
import type { RecordedAgentStep } from '../../shared/types.js';
import { randomUUID } from 'crypto';

export interface AgentLoopResult {
  goalAchieved: boolean;
  finishReason: string;
  stepCount: number;
  actions: string[];
  finalMessage?: string;
  /** Legacy structured tool call data */
  recordedSteps: RecordedAgentStep[];
}

export interface AgentLoopOptions {
  commandId: string;
  instruction: string;
  systemPrompt: string;
  page: Page;
  session: TaskSession;
  model: any;
  maxSteps: number;
  onStatus?: AgentStatusCb;
  onLog: AgentLogCb;
  onRecordStep?: (step: any) => void;
}

function formatToolAction(toolName: string, input: any): string {
  switch (toolName) {
    case 'goto': {
      const url = input?.url || '';
      return `Navigating to ${url || 'page'}`;
    }
    case 'act': {
      const action = input?.action || 'interact';
      const target = input?.index !== undefined
        ? `[${input.index}]${input?.selector ? ` (${input.selector})` : ''}`
        : (input?.selector || 'element');
      const value = input?.value ? ` "${input.value}"` : '';
      return `Action: ${action}${value} on ${target}`;
    }
    case 'observe': {
      const filter = input?.filter || '';
      return filter ? `Observing: ${filter}` : 'Observing page elements';
    }
    case 'extract': {
      const sel = input?.selector || '';
      return sel ? `Extracting from ${sel}` : 'Extracting page content';
    }
    case 'type': {
      return `Typing: "${input?.text || ''}"`;
    }
    case 'getPageUrl': {
      return 'Getting current page URL';
    }
    case 'keys': {
      return `Pressing key: ${input?.key || ''}`;
    }
    case 'scroll': {
      return `Scrolling ${input?.direction || ''} ${input?.pixels || 500}px`;
    }
    case 'done': {
      return 'Task completed';
    }
    case 'notifyUser': {
      return `Update: ${input?.message || ''}`;
    }
    case 'runActionSequence': {
      const count = Array.isArray(input?.actions) ? input.actions.length : 0;
      return `Executing sequence of ${count} actions`;
    }
    default:
      return `Running ${toolName}`;
  }
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
    onStatus,
    onLog,
    onRecordStep,
  } = opts;

  const actions: string[] = [];
  const recordedSteps: RecordedAgentStep[] = [];
  
  if (actions.length === 0 && session.journal) {
    await session.journal.recordUserMessage(instruction);
  }

  const tools = createBrowserTools(page, () => ({
    taskId: commandId,
    step: actions.length + 1,
    taskProgress: `Step ${actions.length + 1} of agent run`,
    abortSignal: session.abortSignal,
  }));
  let goalAchieved = false;
  let finalMessage: string | undefined;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: instruction,
    tools,
    toolChoice: 'auto',
    stopWhen: ({ steps }: any) => session.isCancelled || steps.length >= maxSteps,
    abortSignal: session.abortSignal,

    onStepFinish: async (event) => {
      if (session.isCancelled) return;
      const stepNum = actions.length + 1;
      const hasDone = event.toolCalls?.some((tc: any) => tc.toolName === 'done');
      const hasToolCalls = (event.toolCalls?.length ?? 0) > 0;

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
          const finalInput = { ...actionInfo.input };
          if (actionInfo.toolName === 'act' && actionInfo.input.index !== undefined) {
            if (actionInfo.result?.resolvedSelector) {
              finalInput.selector = actionInfo.result.resolvedSelector;
              console.log(`[agent-loop] selector resolved for act[index=${actionInfo.input.index}]: ${finalInput.selector}`);
            } else {
              console.warn(`[agent-loop] no selector resolved for act[index=${actionInfo.input.index}] — step will be skipped from workflow recording`);
            }
          }
          
          const cleanSummary = formatToolAction(actionInfo.toolName, finalInput);
          onLog({ level: 'info', message: cleanSummary });
          actions.push(cleanSummary);
          
          if (!['think', 'notifyUser', 'done', 'askUser', 'wait'].includes(actionInfo.toolName)) {
            recordedSteps.push({ tool: actionInfo.toolName, summary: cleanSummary, input: finalInput });
            
            const snapshotId = session.journal
              ? await session.journal.recordAgentStep(actionInfo.toolName, finalInput, actionInfo.result, cleanSummary)
              : randomUUID();
            
            if (onRecordStep) {
              let workflowStep: any = null;
              const id = snapshotId;
              const description = finalInput.description || cleanSummary;
              
              if (actionInfo.toolName === 'goto' && finalInput.url) {
                workflowStep = { id, type: 'navigate', url: finalInput.url, onFailure: 'stop' };
              } else if (actionInfo.toolName === 'act' && finalInput.selector && finalInput.selector.trim() !== '') {
                const action = finalInput.action;
                if (action === 'click') {
                  workflowStep = { id, type: 'click', selector: finalInput.selector, description, onFailure: 'self_heal' };
                } else if (action === 'fill') {
                  workflowStep = { id, type: 'fill', selector: finalInput.selector, value: finalInput.value || '', description, onFailure: 'self_heal' };
                } else if (action === 'select') {
                  workflowStep = { id, type: 'select', selector: finalInput.selector, value: finalInput.value || '', description, onFailure: 'self_heal' };
                } else if (action === 'check') {
                  workflowStep = { id, type: 'click', selector: finalInput.selector, description: description || `Check ${finalInput.selector}`, onFailure: 'self_heal' };
                } else if (action === 'press') {
                  workflowStep = { id, type: 'keypress', key: finalInput.value || 'Enter', onFailure: 'skip' };
                } else if (action === 'uncheck' || action === 'focus' || action === 'hover') {
                  workflowStep = { id, type: 'click', selector: finalInput.selector, description: description || `${action} on ${finalInput.selector}`, onFailure: 'self_heal' };
                }
              } else if (actionInfo.toolName === 'keys' && finalInput.key) {
                workflowStep = { id, type: 'keypress', key: finalInput.key, onFailure: 'skip' };
              } else if (actionInfo.toolName === 'extract' && finalInput.instruction) {
                workflowStep = { id, type: 'extract', instruction: finalInput.instruction, onFailure: 'skip' };
              }
              
              if (workflowStep) {
                onRecordStep(workflowStep);
              } else {
                onLog({ level: 'warn', message: `Skipped recording step for ${actionInfo.toolName} (no mapped selector/action)` });
              }
            }
          }
          if (actionInfo.toolName === 'done') {
            goalAchieved = true;
            finalMessage = finalInput.message;
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

  return {
    goalAchieved,
    finishReason: result.finishReason,
    stepCount: result.steps?.length ?? actions.length,
    actions,
    finalMessage,
    recordedSteps,
  };
}
