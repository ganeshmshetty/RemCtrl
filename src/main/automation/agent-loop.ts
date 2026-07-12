/**
 * Agent Loop — Single-tier tool-calling loop using Vercel AI SDK generateText
 */

import { generateText } from 'ai';
import type { Page } from 'playwright';
import { createBrowserTools } from './agent-tools.js';
import type { AgentLogCb, AgentStatusCb } from './execution-engine.js';
import type { TaskSession } from './task-session.js';

export interface AgentLoopResult {
  goalAchieved: boolean;
  finishReason: string;
  stepCount: number;
  actions: string[];
  finalMessage?: string;
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
  } = opts;

  const actions: string[] = [];
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
        const input = (tc as any).input ?? (tc as any).args ?? {};
        const cleanSummary = formatToolAction(tc.toolName, input);
        onLog({ level: 'info', message: cleanSummary });
        actions.push(cleanSummary);
        if (tc.toolName === 'done') {
          goalAchieved = true;
          finalMessage = input.message;
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
  };
}
