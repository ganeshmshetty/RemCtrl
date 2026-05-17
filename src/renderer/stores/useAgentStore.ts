import { create } from 'zustand';
import type { AgentStatusPayload, AgentLogPayload } from '../../shared/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log' | 'error';
  text: string;
  timestamp: number;
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

interface AgentState {
  isTakeoverActive: boolean;
  agentStatus: AgentStatus;
  activeCommandId: string | null;
  chatHistory: ChatMessage[];

  // Actions
  setTakeoverActive: (active: boolean) => void;
  setAgentStatus: (status: AgentStatus) => void;
  setActiveCommandId: (id: string | null) => void;
  appendMessage: (msg: ChatMessage) => void;
  handleAgentStatus: (payload: AgentStatusPayload) => void;
  handleAgentLog: (payload: AgentLogPayload) => void;
  clearHistory: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  isTakeoverActive: false,
  agentStatus: 'idle',
  activeCommandId: null,
  chatHistory: [],

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

  clearHistory: () => set({ chatHistory: [] }),
}));
