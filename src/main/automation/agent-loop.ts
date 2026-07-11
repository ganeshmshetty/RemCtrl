/**
 * Agent Loop — Single-tier tool-calling loop using Vercel AI SDK generateText
 */

import { generateText, stepCountIs } from 'ai';
import type { Page } from 'playwright';
import { createBrowserTools } from './agent-tools.js';
import { StallDetector, createPageFingerprint } from './stall-detector.js';
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
      const selector = input?.selector || 'element';
      const value = input?.value ? ` "${input.value}"` : '';
      return `Action: ${action}${value} on ${selector}`;
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
      return `Completing task: ${input?.message || 'Done'}`;
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

  const tools = createBrowserTools(page);
  const stallDetector = new StallDetector();
  const actions: string[] = [];
  let goalAchieved = false;
  let finalMessage: string | undefined;

  try {
    stallDetector.recordFingerprint(await createPageFingerprint(page as any));
  } catch {
    // ignore
  }

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: instruction,
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(maxSteps),
    abortSignal: session.abortSignal,

    onStepFinish: async (event) => {
      const stepNum = actions.length + 1;
      const hasDone = event.toolCalls?.some((tc: any) => tc.toolName === 'done');

      if (event.text && event.text.trim() && !hasDone) {
        const trimmed = event.text.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('["') && !trimmed.startsWith('```json')) {
          onLog({ level: 'info', message: trimmed });
        }
      }

      for (const tc of event.toolCalls ?? []) {
        const input = (tc as any).input ?? (tc as any).args ?? {};
        const cleanSummary = formatToolAction(tc.toolName, input);
        onLog({ level: 'info', message: cleanSummary });
        actions.push(cleanSummary);

        if (tc.toolName === 'done' && input.taskComplete) {
          goalAchieved = true;
          finalMessage = input.message;
        }
      }

      if (!goalAchieved && !hasDone) {
        try {
          stallDetector.recordFingerprint(await createPageFingerprint(page as any));
        } catch {
          // page may have navigated
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
