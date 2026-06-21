import { create } from 'zustand';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentCheckpointPayload,
} from '../../shared/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log' | 'error' | 'workflow' | 'checkpoint';
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

    if (payload.state === 'running') {
      updates.currentAction = 'Initializing agent...';
    } else if (['completed', 'failed', 'cancelled'].includes(payload.state)) {
      updates.currentAction = null;
    }

    set(updates);
    
    if (payload.state === 'completed') {
      get().appendMessage({
        id: `status-${payload.commandId}-${Date.now()}`,
        sender: 'agent',
        type: 'status',
        text: `I successfully completed the task! ${payload.result ? `\nResult: ${JSON.stringify(payload.result, null, 2)}` : ''}`,
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
      // Only set current action if it's an info-level log without being overly verbose.
      // Stagehand logs can be chatty, so we'll just pick the most recent one.
      const isActionable = payload.level === 'info' && !payload.message.includes('browser-use') && !payload.message.includes('playwright');
      return {
        executionLogs: [...(state.executionLogs || []), payload],
        currentAction: isActionable ? payload.message : state.currentAction,
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
    set({
      workflowRunState: stateMap[status.state] ?? 'idle',
      workflowRunId: status.workflowRunId,
      currentStepIndex: status.currentStepIndex ?? null,
    });
    // Also surface to chat
    get().appendMessage({
      id: `wf-run-${status.workflowRunId}-${status.state}-${Date.now()}`,
      sender: 'agent',
      type: 'workflow',
      text: status.error
        ? `Workflow ${status.state}: ${status.error}`
        : `Workflow ${status.state}${status.currentStepIndex != null ? ` (step ${status.currentStepIndex + 1})` : ''}`,
      timestamp: Date.now(),
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
  },

  clearHistory: () => set({ chatHistory: [], executionLogs: [], currentAction: null }),

  clearWorkflow: () =>
    set({
      workflowRunState: 'idle',
      workflowRunId: null,
      workflowStepStatuses: [],
      currentStepIndex: null,
    }),
}));
