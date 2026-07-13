import { create } from 'zustand';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentCheckpointPayload,
  AutomationRunHistoryItem,
  RecordedAgentStep,
} from '../../shared/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log' | 'warn' | 'error' | 'workflow' | 'checkpoint';
  text: string;
  timestamp: number;
  checkpointPayload?: AgentCheckpointPayload;
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
type WorkflowState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AgentState {
  isTakeoverActive: boolean;
  agentStatus: AgentStatus;
  activeCommandId: string | null;
  chatHistory: ChatMessage[];
  executionLogs: AgentLogPayload[];
  currentAction: string | null;

  // Workflow run state
  workflowRunState: WorkflowState;
  workflowRunId: string | null;
  workflowStepStatuses: WorkflowStepStatus[];
  currentStepIndex: number | null;

  // Run History & Lifecycle
  runHistory: AutomationRunHistoryItem[];
  currentRunTitle: string | null;
  currentRunStartTime: number | null;
  lastOutcome: 'completed' | 'error' | 'cancelled' | null;

  /** Structured steps recorded from the last successful agent run (for Save as Workflow) */
  lastRecordedSteps: RecordedAgentStep[];
  /** The original user prompt from the last agent run */
  lastCompletedPrompt: string | null;
  /** Set recorded steps from agent-loop (called by execution-engine after run completes) */
  setLastRecordedSteps: (steps: RecordedAgentStep[], prompt: string) => void;

  archiveCurrentRun: (finalStatus?: 'completed' | 'error' | 'cancelled', error?: string) => void;
  startNewExecution: (type: 'agent' | 'workflow', id: string, title: string) => void;

  // Actions
  setTakeoverActive: (active: boolean) => void;
  setAgentStatus: (status: AgentStatus) => void;
  setActiveCommandId: (id: string | null) => void;
  appendMessage: (msg: ChatMessage) => void;
  handleAgentStatus: (payload: AgentStatusPayload) => void;
  handleAgentLog: (payload: AgentLogPayload) => void;
  handleWorkflowRunStatus: (status: WorkflowRunStatus) => void;
  handleWorkflowStepStatus: (status: WorkflowStepStatus) => void;
  handleAgentCheckpoint: (payload: AgentCheckpointPayload) => void;
  clearHistory: () => void;
  clearWorkflow: () => void;
  startNewChat: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  isTakeoverActive: false,
  agentStatus: 'idle',
  activeCommandId: null,
  chatHistory: [],
  executionLogs: [],
  currentAction: null,

  workflowRunState: 'idle',
  workflowRunId: null,
  workflowStepStatuses: [],
  currentStepIndex: null,

  runHistory: [],
  currentRunTitle: null,
  currentRunStartTime: null,
  lastOutcome: null,

  lastRecordedSteps: [],
  lastCompletedPrompt: null,

  setLastRecordedSteps: (steps, prompt) => set({ lastRecordedSteps: steps, lastCompletedPrompt: prompt }),

  setTakeoverActive: (active) => set({ isTakeoverActive: active }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setActiveCommandId: (id) => set({ activeCommandId: id }),

  appendMessage: (msg) =>
    set((state) => ({
      chatHistory: [...state.chatHistory, msg],
    })),

  handleAgentStatus: (payload) => {
    const statusMap: Record<string, AgentStatus> = {
      running: 'running',
      completed: 'completed',
      failed: 'error',
      cancelled: 'idle',
      paused: 'paused',
    };
    
    const updates: Partial<AgentState> = {
      agentStatus: statusMap[payload.state] ?? 'idle',
      activeCommandId: payload.state === 'running' ? payload.commandId : null,
    };

    if (payload.state === 'completed') {
      updates.lastOutcome = 'completed';
    } else if (payload.state === 'failed') {
      updates.lastOutcome = 'error';
    } else if (payload.state === 'cancelled') {
      updates.lastOutcome = 'cancelled';
    }

    if (payload.state === 'running') {
      updates.currentAction = 'Initializing agent...';
      updates.lastOutcome = null;
    } else if (['completed', 'failed', 'cancelled'].includes(payload.state)) {
      updates.currentAction = null;
    }

    set(updates);
    
    if (payload.state === 'completed') {
      const result = payload.result as any;
      // Store recorded steps for Save as Workflow
      if (result?.recordedSteps?.length) {
        get().setLastRecordedSteps(result.recordedSteps, result.originalInstruction ?? '');
      }
      const formattedResult = formatAgentResult(payload.result);
      get().appendMessage({
        id: `status-${payload.commandId}-${Date.now()}`,
        sender: 'agent',
        type: 'status',
        text: formattedResult,
        timestamp: Date.now(),
      });
    } else if (payload.state === 'failed') {
      get().appendMessage({
        id: `error-${payload.commandId}-${Date.now()}`,
        sender: 'agent',
        type: 'error',
        text: `I encountered an issue and couldn't complete the task: ${payload.error || 'Unknown error'}`,
        timestamp: Date.now(),
      });
    }
  },


  handleAgentLog: (payload) => {
    set((state) => {
      const msgTrim = payload.message?.trim() || '';
      const isJsonOutput = msgTrim.startsWith('{') || msgTrim.startsWith('["') || msgTrim.startsWith('```json');
      const isEngineNoise =
        msgTrim.includes('[StagehandPool]') ||
        msgTrim.includes('Stagehand') ||
        msgTrim.includes('Connecting to local browser') ||
        msgTrim.includes('Starting — model=') ||
        msgTrim.includes('Pipeline complete') ||
        msgTrim.includes('CDP:') ||
        payload.message.includes('browser-use') ||
        payload.message.includes('playwright');

      const isNotify = payload.message.startsWith('Update: ');
      const isActionable = payload.level === 'info' && !isJsonOutput && !isEngineNoise;

      let newHistory = state.chatHistory;
      if (isNotify) {
        newHistory = [
          ...newHistory,
          {
            id: `notify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            sender: 'agent' as const,
            type: 'status' as const,
            text: payload.message.replace(/^Update:\s*/, ''),
            timestamp: Date.now(),
          },
        ];
      } else if (isActionable) {
        const lastMsg = state.chatHistory.at(-1);
        const isDuplicateOfLast = lastMsg?.type === 'log' && lastMsg?.text === payload.message;
        if (!isDuplicateOfLast) {
          newHistory = [
            ...newHistory,
            {
              id: `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              sender: 'agent' as const,
              type: 'log' as const,
              text: payload.message,
              timestamp: Date.now(),
            },
          ];
        }
      }

      return {
        executionLogs: [...(state.executionLogs || []), payload],
        currentAction: isActionable ? payload.message : state.currentAction,
        chatHistory: newHistory,
      };
    });
  },

  handleWorkflowRunStatus: (status) => {
    const stateMap: Record<WorkflowRunStatus['state'], WorkflowState> = {
      queued: 'idle',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
    };
    set((state) => {
      const newHistory = [...state.chatHistory];
      const newLogs = [...state.executionLogs];
      if (status.state === 'failed' && status.error) {
        newHistory.push({
          id: `wf-err-${Date.now()}`,
          sender: 'agent',
          type: 'error',
          text: `Workflow failed: ${status.error}`,
          timestamp: Date.now(),
        });
        newLogs.push({
          level: 'error',
          message: status.error,
          step: '[Workflow]',
        });
      } else if (status.state === 'completed') {
        newHistory.push({
          id: `wf-done-${Date.now()}`,
          sender: 'agent',
          type: 'workflow',
          text: 'Workflow completed successfully ✓',
          timestamp: Date.now(),
        });
      }
      let lastOutcome: 'completed' | 'error' | 'cancelled' | null = null;
      if (status.state === 'completed') lastOutcome = 'completed';
      else if (status.state === 'failed') lastOutcome = 'error';
      else if (status.state === 'cancelled') lastOutcome = 'cancelled';

      return {
        workflowRunState: stateMap[status.state] ?? 'idle',
        workflowRunId: status.workflowRunId,
        currentStepIndex: status.currentStepIndex ?? state.currentStepIndex,
        chatHistory: newHistory,
        executionLogs: newLogs,
        lastOutcome,
      };
    });
  },

  handleWorkflowStepStatus: (status) => {
    set((state) => {
      const existing = state.workflowStepStatuses.findIndex(
        (s) => s.stepId === status.stepId && s.workflowRunId === status.workflowRunId,
      );
      const updated = [...state.workflowStepStatuses];
      if (existing >= 0) {
        updated[existing] = status;
      } else {
        updated.push(status);
      }
      return { workflowStepStatuses: updated };
    });
  },

  handleAgentCheckpoint: (payload) => {
    get().appendMessage({
      id: `checkpoint-${payload.checkpointId}`,
      sender: 'agent',
      type: 'checkpoint',
      text: payload.question,
      timestamp: Date.now(),
      checkpointPayload: payload,
    });
    if (typeof window !== 'undefined' && window.Notification) {
      if (window.Notification.permission === 'granted') {
        new window.Notification('RemoteCtrl: Agent Needs Input', { body: payload.question });
      } else if (window.Notification.permission !== 'denied') {
        window.Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new window.Notification('RemoteCtrl: Agent Needs Input', { body: payload.question });
          }
        }).catch(() => { /* permission request failed; ignore */ });
      }
    }
  },

  archiveCurrentRun: (finalStatus = 'completed', error) => {
    const state = get();
    if (state.chatHistory.length === 0 && state.executionLogs.length === 0) return;
    const id = state.activeCommandId || state.workflowRunId || `run-${Date.now()}`;
    const type = state.workflowRunId ? 'workflow' : 'agent';
    const title = state.currentRunTitle || (type === 'workflow' ? 'Workflow Execution' : 'Agent Execution');
    const newItem: AutomationRunHistoryItem = {
      id,
      type,
      title,
      startTime: state.currentRunStartTime || Date.now(),
      endTime: Date.now(),
      status: finalStatus,
      logs: [...state.executionLogs],
      chatHistory: [...state.chatHistory],
      error,
    };
    set({
      runHistory: [newItem, ...state.runHistory].slice(0, 30),
    });
  },

  startNewExecution: (type, id, title) => {
    const state = get();
    set({
      chatHistory: state.chatHistory,
      executionLogs: [],
      currentAction: null,
      lastOutcome: null,
      agentStatus: type === 'agent' ? 'running' : 'idle',
      activeCommandId: type === 'agent' ? id : null,
      workflowRunState: type === 'workflow' ? 'running' : 'idle',
      workflowRunId: type === 'workflow' ? id : null,
      workflowStepStatuses: [],
      currentStepIndex: null,
      currentRunTitle: state.currentRunTitle || title,
      currentRunStartTime: state.currentRunStartTime || Date.now(),
    });
  },

  clearHistory: () => {
    (window as any).RemoteCtrlAPI?.agent?.clearHistory?.();
    set({ chatHistory: [], executionLogs: [], currentAction: null });
  },

  clearWorkflow: () =>
    set({
      workflowRunState: 'idle',
      workflowRunId: null,
      workflowStepStatuses: [],
      currentStepIndex: null,
    }),

  startNewChat: () => {
    const state = get();
    if (state.chatHistory.length > 0 || state.executionLogs.length > 0) {
      const lastStatus = state.lastOutcome ||
        (state.agentStatus === 'error' || state.workflowRunState === 'failed'
          ? 'error'
          : 'completed');
      state.archiveCurrentRun(lastStatus);
    }
    set({
      chatHistory: [],
      executionLogs: [],
      currentAction: null,
      lastOutcome: null,
      agentStatus: 'idle',
      activeCommandId: null,
      workflowRunState: 'idle',
      workflowRunId: null,
      workflowStepStatuses: [],
      currentStepIndex: null,
      currentRunTitle: null,
      currentRunStartTime: null,
    });
  },
}));

function formatAgentResult(result: any): string {
  if (!result) return 'I successfully completed the task!';
  
  if (typeof result === 'string') return result;
  
  if (typeof result === 'object') {
    if (result.finalMessage) {
      return result.finalMessage;
    }
    if (result.message) {
      return result.message;
    }
    if (result.taskId || result.actions || result.status) {
      return result.finalMessage || result.message || 'Task completed successfully.';
    }
    
    if (Array.isArray(result)) {
      if (result.length === 0) return 'I found no results.';
      const items = result.map(item => {
        if (typeof item === 'object') {
          return Object.entries(item)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        }
        return String(item);
      });
      return 'Here is what I found:\n\n' + items.map(i => `• ${i}`).join('\n');
    }

    return 'Here is what I found:\n\n' + Object.entries(result)
      .map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');
  }
  
  return String(result);
}
