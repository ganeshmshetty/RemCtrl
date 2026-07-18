/**
 * @file useAgentStore.ts
 * @description Zustand store for managing agent execution state, workflow runs, chat feeds, checkpoints, and run histories.
 * Exports the `useAgentStore` hook and `ChatMessage` interface to drive the main execution logs, chat UI, and status indicators.
 * Internally handles state mapping, browser notification requests during agent checkpoints, and log filtering.
 * Connects with `RemoteCtrlAPI` for history clearing and handles state updates received from IPC events via `ipcRenderer` bindings.
 */

import { create } from 'zustand';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentCheckpointPayload,
  AutomationRunHistoryItem,
  AutomationRunChatMessage,
  AgentActivityEntry,
  RecordedAgentStep,
  AutomationRunCheckpoint,
} from '../../shared/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log' | 'warn' | 'error' | 'workflow' | 'checkpoint';
  text: string;
  timestamp: number;
  checkpointPayload?: AgentCheckpointPayload;
  activity?: AgentActivityEntry[];
  isFinal?: boolean;
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
type WorkflowState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
export type WorkflowRecordingState = 'idle' | 'recording' | 'saving' | 'saved' | 'error';

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

  // Explicit multi-prompt workflow recording lifecycle
  recordingState: WorkflowRecordingState;
  recordingSessionId: string | null;
  recordingTask: string | null;
  recordingStepCount: number;
  recordingError: string | null;

  // Run History & Lifecycle
  runHistory: AutomationRunHistoryItem[];
  recoverableRuns: AutomationRunCheckpoint[];
  currentRunTitle: string | null;
  currentRunStartTime: number | null;
  activeSessionId: string | null;
  lastOutcome: 'completed' | 'error' | 'cancelled' | null;

  /** Structured steps recorded from the last successful agent run (for Save as Workflow) */
  lastRecordedSteps: RecordedAgentStep[];
  /** The original user prompt from the last agent run */
  lastCompletedPrompt: string | null;
  /** Set recorded steps from agent-loop (called by execution-engine after run completes) */
  setLastRecordedSteps: (steps: RecordedAgentStep[], prompt: string) => void;
  setRecordingState: (state: Partial<Pick<AgentState, 'recordingState' | 'recordingSessionId' | 'recordingTask' | 'recordingStepCount' | 'recordingError'>>) => void;
  clearRecordingState: () => void;

  archiveCurrentRun: (finalStatus?: 'completed' | 'error' | 'cancelled', error?: string) => void;
  startNewExecution: (type: 'agent' | 'workflow', id: string, title: string) => void;
  loadRunHistory: () => Promise<void>;
  resumeRunHistory: (item: AutomationRunHistoryItem) => void;
  deleteRunHistory: (id: string) => Promise<void>;
  clearRunHistory: () => Promise<void>;
  loadRecoverableRuns: () => Promise<void>;
  dismissRecoverableRun: (id: string) => Promise<void>;

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

  recordingState: 'idle',
  recordingSessionId: null,
  recordingTask: null,
  recordingStepCount: 0,
  recordingError: null,

  runHistory: [],
  recoverableRuns: [],
  currentRunTitle: null,
  currentRunStartTime: null,
  activeSessionId: null,
  lastOutcome: null,

  lastRecordedSteps: [],
  lastCompletedPrompt: null,

  setLastRecordedSteps: (steps, prompt) => set({ lastRecordedSteps: steps, lastCompletedPrompt: prompt }),
  setRecordingState: (updates) => set(updates),
  clearRecordingState: () => set({ recordingState: 'idle', recordingSessionId: null, recordingTask: null, recordingStepCount: 0, recordingError: null }),

  setTakeoverActive: (active) => set({ isTakeoverActive: active }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setActiveCommandId: (id) => set({ activeCommandId: id }),

  appendMessage: (msg) => {
    set((state) => ({ chatHistory: [...state.chatHistory, msg] }));
  },

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
      const current = get();
      updates.currentAction = current.activeCommandId === payload.commandId && current.currentAction
        ? current.currentAction
        : 'Initializing agent...';
      updates.lastOutcome = null;
    } else if (['completed', 'failed', 'cancelled'].includes(payload.state)) {
      updates.currentAction = null;
    }

    set(updates);

    if (['completed', 'failed', 'cancelled'].includes(payload.state)) {
      const terminalState = payload.state === 'failed' ? 'failed' as const : 'completed' as const;
      set((state) => ({
        chatHistory: state.chatHistory.map((message) => message.id === `user-${payload.commandId}` && message.activity
          ? { ...message, activity: message.activity.map((activity) => activity.state === 'running' ? { ...activity, state: terminalState } : activity) }
          : message),
      }));
    }
    
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
        isFinal: true,
      });
      get().archiveCurrentRun('completed');
    } else if (payload.state === 'failed') {
      get().appendMessage({
        id: `error-${payload.commandId}-${Date.now()}`,
        sender: 'agent',
        type: 'status',
        text: `I encountered an issue and couldn't complete the task: ${payload.error || 'Unknown error'}`,
        timestamp: Date.now(),
      });
      get().archiveCurrentRun('error', payload.error);
    } else if (payload.state === 'cancelled') {
      get().archiveCurrentRun('cancelled');
    }
  },


  handleAgentLog: (payload) => {
    set((state) => {
      const msgTrim = payload.message?.trim() || '';
      const isJsonOutput = msgTrim.startsWith('{') || msgTrim.startsWith('["') || msgTrim.startsWith('```json');
      const isEngineNoise = isInternalDiagnostic(msgTrim);

      const isNotify = payload.message.startsWith('Update: ');
      const isWorkflowLog = state.workflowRunState === 'running' || state.workflowRunState === 'completed' || state.workflowRunState === 'failed' || state.workflowRunState === 'cancelled';
      // Workflow logs are rendered in the Workflows tab. Keep preparation,
      // waits, retries, warnings, and failures even when they are not phrased
      // as an agent-facing semantic activity.
      const isActionable = !isJsonOutput && (
        (payload.level === 'info' && !isEngineNoise && isSemanticActivity(msgTrim))
        || (isWorkflowLog && !isEngineNoise)
      );

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
      }

      const commandId = payload.commandId ?? state.activeCommandId;
      const updatedHistory = isActionable && payload.level === 'info' && commandId
        ? state.chatHistory.map((message) => {
            if (message.id !== `user-${commandId}`) return message;
            const current = message.activity ?? [];
            const indexedActivities = [...current].map((entry, index) => ({ entry, index })).reverse();
            const runningIndex = (indexedActivities.find(({ entry }) => entry.state === 'running' && entry.text === payload.message)
              ?? indexedActivities.find(({ entry }) => entry.state === 'running'))?.index;
            if (payload.phase === 'started' || runningIndex === undefined) {
              const startedAt = Date.now();
              return {
                ...message,
                activity: [...current, {
                  id: `activity-${startedAt}-${Math.random().toString(36).slice(2)}`,
                  text: payload.message,
                  state: 'running',
                  timestamp: startedAt,
                }],
              };
            }
            const completedAt = Date.now();
            const activity = current.map((entry, index) => index === runningIndex
              ? {
                  ...entry,
                  text: payload.message,
                  state: payload.level === 'error' || payload.phase === 'failed' ? 'failed' as const : 'completed' as const,
                  completedAt,
                  durationMs: Math.max(0, completedAt - entry.timestamp),
                }
              : entry);
            return { ...message, activity };
          })
        : newHistory;

      return {
        executionLogs: isActionable ? [...(state.executionLogs || []), { ...payload, timestamp: Date.now() }] : state.executionLogs,
        currentAction: isActionable ? payload.message : state.currentAction,
        chatHistory: updatedHistory,
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
    if (status.state === 'completed') get().archiveCurrentRun('completed');
    else if (status.state === 'failed') get().archiveCurrentRun('error', status.error);
    else if (status.state === 'cancelled') get().archiveCurrentRun('cancelled');
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
    const id = state.activeSessionId || `session-${Date.now()}`;
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
      chatHistory: state.chatHistory.filter((message): message is ChatMessage & AutomationRunChatMessage => message.type !== 'log'),
      error,
    };
    set({ runHistory: [newItem, ...state.runHistory.filter((item) => item.id !== id)].slice(0, 30) });
    void window.RemoteCtrlAPI?.agent.saveRunHistory(newItem);
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
      activeSessionId: state.activeSessionId || `session-${id}`,
    });
  },

  clearHistory: () => {
    (window as any).RemoteCtrlAPI?.agent?.clearHistory?.();
    set({ chatHistory: [], executionLogs: [], currentAction: null });
  },

  loadRunHistory: async () => {
    const runHistory = await window.RemoteCtrlAPI?.agent.listRunHistory() ?? [];
    set({ runHistory });
  },

  resumeRunHistory: (item) => {
    set({
      chatHistory: item.chatHistory as ChatMessage[],
      executionLogs: item.logs,
      currentAction: null,
      lastOutcome: item.status,
      agentStatus: 'idle',
      activeCommandId: null,
      workflowRunState: 'idle',
      workflowRunId: null,
      workflowStepStatuses: [],
      currentStepIndex: null,
      currentRunTitle: item.title,
      currentRunStartTime: item.startTime,
      activeSessionId: item.id,
    });
  },

  deleteRunHistory: async (id) => {
    await window.RemoteCtrlAPI?.agent.deleteRunHistory(id);
    set((state) => ({ runHistory: state.runHistory.filter((item) => item.id !== id) }));
  },

  clearRunHistory: async () => {
    await window.RemoteCtrlAPI?.agent.clearRunHistory();
    set({ runHistory: [] });
  },

  loadRecoverableRuns: async () => {
    const recoverableRuns = await window.RemoteCtrlAPI?.agent.listRecoverableRuns() ?? [];
    set({ recoverableRuns });
  },

  dismissRecoverableRun: async (id) => {
    await window.RemoteCtrlAPI?.agent.discardRecoverableRun(id);
    set((state) => ({ recoverableRuns: state.recoverableRuns.filter((run) => run.id !== id) }));
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
    // Keep the main-process prompt context in sync with the renderer's new
    // conversation. Without this, a command-palette "New agent session"
    // visually clears the chat while the next model call still sees old turns.
    void window.RemoteCtrlAPI?.agent.clearHistory();
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
      activeSessionId: null,
    });
  },
}));

function isInternalDiagnostic(message: string): boolean {
  return /\[(?:ExecutionEngine|Browser|StagehandPool|Stagehand|MAIN)\]|\b(?:CDP|Playwright|browser-use|pipeline|provider=|model=|Vertex AI|Google Generative AI)\b/i.test(message)
    || message.includes('Connecting to local browser');
}

function isSemanticActivity(message: string): boolean {
  return /^(?:Navigating|Opening|Reading|Observing|Analyzing|Finding|Looking|Getting|Click(?:ing)?|Selecting|Entering|Typing|Filling|Pressing|Scrolling|Extracting|Checking|Verifying|Waiting|Executing|Action:|Completing)/i.test(message);
}

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
