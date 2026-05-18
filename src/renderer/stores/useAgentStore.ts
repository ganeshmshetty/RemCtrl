import { create } from 'zustand';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
} from '../../shared/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log' | 'error' | 'workflow';
  text: string;
  timestamp: number;
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
type WorkflowState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AgentState {
  isTakeoverActive: boolean;
  agentStatus: AgentStatus;
  activeCommandId: string | null;
  chatHistory: ChatMessage[];

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
  clearHistory: () => void;
  clearWorkflow: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  isTakeoverActive: false,
  agentStatus: 'idle',
  activeCommandId: null,
  chatHistory: [],

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
    set({
      agentStatus: statusMap[payload.state] ?? 'idle',
      activeCommandId: payload.state === 'running' ? payload.commandId : null,
    });
    get().appendMessage({
      id: `status-${payload.commandId}-${Date.now()}`,
      sender: 'agent',
      type: 'status',
      text: payload.error
        ? `Command ${payload.state}: ${payload.error}`
        : `Command ${payload.state}${payload.result ? ` — ${JSON.stringify(payload.result)}` : ''}`,
      timestamp: Date.now(),
    });
  },

  handleAgentLog: (payload) => {
    get().appendMessage({
      id: `log-${Date.now()}-${Math.random()}`,
      sender: 'agent',
      type: 'log',
      text: `[${payload.level}] ${payload.message}`,
      timestamp: Date.now(),
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

  clearHistory: () => set({ chatHistory: [] }),

  clearWorkflow: () =>
    set({
      workflowRunState: 'idle',
      workflowRunId: null,
      workflowStepStatuses: [],
      currentStepIndex: null,
    }),
}));
