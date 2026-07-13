/**
 * @file types.ts
 * @description Centralized TypeScript interface and type definitions shared across the Main and Renderer processes.
 * @module shared/types
 * 
 * Key Exports:
 * - Workflow & Automation: `WorkflowStep`, `LocalWorkflow`, `RecordedAgentStep`, and step enum/payload definitions.
 * - State Management: `HostSessionState` and `ControllerSessionState` tracking signaling and connection lifecycles.
 * - Remote Control & WebRTC: `DataChannelMessage`, `RemoteMousePayload`, `RemoteKeyboardPayload`, and `CaptureMetadata`.
 * - IPC Contract: `RemoteCtrlAPI` interface detailing method signatures (app, host, controller, browser, settings, workflows) and push listeners.
 * 
 * Mechanics & Relations:
 * - Serves as the single source of truth for communication boundaries (both local IPC via Preload and WebRTC Data Channels).
 * - Declares global window properties for `RemoteCtrlAPI` to ensure TypeScript safety within frontend views.
 */

export type StepType = 'navigate' | 'click' | 'fill' | 'select' | 'keypress' | 'wait' | 'extract' | 'check';

export type BaseStep = {
  id: string;
  onFailure: 'stop' | 'skip' | 'retry' | 'self_heal';
};

export type WorkflowStep =
  | (BaseStep & { type: 'navigate'; url: string })
  | (BaseStep & { type: 'click'; selector: string; description?: string })
  | (BaseStep & { type: 'fill'; selector: string; value: string; description?: string })
  | (BaseStep & { type: 'select'; selector: string; value: string; description?: string })
  | (BaseStep & { type: 'keypress'; key: string })
  | (BaseStep & { type: 'wait'; ms: number })
  | (BaseStep & { type: 'extract'; instruction: string })
  | (BaseStep & { type: 'check'; condition: string; onTrue?: string; onFalse?: string });

/** A single structured step recorded from an AI agent run */
export interface RecordedAgentStep {
  /** Tool used: goto, act, scroll, keys, type, etc. */
  tool: string;
  /** Summary shown to the user (e.g. 'Navigating to https://...') */
  summary: string;
  /** Raw tool input arguments */
  input: Record<string, unknown>;
}

export interface LocalWorkflow {
  id: string;
  name: string;
  description?: string;
  startUrl?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
  /** How this workflow was originally created */
  source?: 'ai_recorded' | 'chrome_ext' | 'manual';
}

// Future-compatible cloud record shape (deferred, kept for type compatibility)
export interface SharedWorkflowRecord {
  id: string;
  ownerId?: string;
  workflow: LocalWorkflow;
  createdAt: number;
  updatedAt: number;
}

// ─── Settings Types ────────────────────────────────────────────────────────────

export type ApiProvider = 'openai' | 'anthropic' | 'gemini' | 'groq' | 'deepseek' | 'nebius' | 'openrouter' | 'vertex';
export type BrowserMode = 'internal' | 'local_chrome';
export type AppTheme = 'light' | 'dark' | 'system';

export interface AppSettings {
  signalingUrl: string;
  preferredProvider: ApiProvider;
  preferredModel?: string;
  customBaseUrls?: Record<string, string>;
  browserMode: BrowserMode;
  theme: AppTheme;
  // API keys are NOT stored in renderer — Main process holds them
}

// ─── Session / Connection Types ────────────────────────────────────────────────

export type SessionRole = 'host' | 'controller';

export type HostSessionState =
  | 'IDLE'
  | 'CHECKING_PERMISSIONS'
  | 'LAUNCHING_BROWSER'
  | 'REGISTERING_PIN'
  | 'WAITING_FOR_CONTROLLER'
  | 'AWAITING_HOST_APPROVAL'
  | 'WEBRTC_CONNECTING'
  | 'SESSION_ACTIVE'
  | 'AGENT_EXECUTING'
  | 'CANCELLING_AGENT'
  | 'HUMAN_TAKEOVER'
  | 'DISCONNECTED';

export type ControllerSessionState =
  | 'IDLE'
  | 'PROMPTING_FOR_PIN'
  | 'SIGNALING_CONNECTING'
  | 'WAITING_FOR_HOST_APPROVAL'
  | 'WEBRTC_CONNECTING'
  | 'SESSION_ACTIVE'
  | 'CONTROLLING_REMOTELY'
  | 'DISCONNECTED';

// ─── Agent Types ───────────────────────────────────────────────────────────────

/** Actions used by the Agent panel — separate from workflow StepType */
export type AgentAction =
  | 'act'
  | 'observe'
  | 'extract'
  | 'goto'
  | 'scroll'
  | 'keys'
  | 'wait'
  | 'think'
  | 'done'
  | 'clipboard_read'
  | 'clipboard_write'
  | 'invoke_mcp'
  | 'playwright_action';

export interface AgentPromptPayload {
  commandId: string;
  action: AgentAction;
  instruction: string;
}

export interface AgentRewindPayload {
  snapshotId: string;
  commandId: string;
  action: 'act' | 'observe' | 'extract' | 'clipboard_read' | 'clipboard_write' | 'invoke_mcp' | 'playwright_action';
  newInstruction: string;
}

export interface AgentStatusPayload {
  commandId: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  result?: unknown;
  error?: string;
}

export interface AgentLogPayload {
  level: 'info' | 'warn' | 'error';
  message: string;
  step?: string;
}

export interface AgentCheckpointPayload {
  checkpointId: string;
  taskId: string;
  step: number;
  question: string;
  options: { id: string; label: string; description?: string; recommended?: boolean }[];
  context: {
    currentPage: string;
    taskProgress: string;
    uncertainty?: string;
  };
}

export interface CheckpointResponse {
  selectedOptionId: string;
  customInput?: string;
}

export interface AutomationRunHistoryItem {
  id: string;
  type: 'agent' | 'workflow';
  title: string;
  startTime: number;
  endTime?: number;
  status: 'completed' | 'error' | 'cancelled';
  logs: { level: 'info' | 'warn' | 'error'; message: string; step?: string; timestamp?: number }[];
  chatHistory: any[];
  error?: string;
}

// ─── Workflow Run Types ────────────────────────────────────────────────────────

export interface AgentWorkflowBatchPayload {
  workflowRunId: string;
  workflowId: string;
  name: string;
  startUrl?: string;
  steps: WorkflowStep[]; // WorkflowStep uses new StepType model
}

export interface WorkflowRunStatus {
  workflowRunId: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepId?: string;
  currentStepIndex?: number;
  error?: string;
}

export interface WorkflowStepStatus {
  workflowRunId: string;
  stepId: string;
  index: number;
  state: 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
}

// ─── Capture Metadata ─────────────────────────────────────────────────────────

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface CaptureMetadata {
  captureWidth: number;
  captureHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  contentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ─── Data Channel Messages ────────────────────────────────────────────────────

export type MessageType =
  | 'SESSION_START'
  | 'CAPTURE_METADATA'
  | 'TAB_LIST'
  | 'SWITCH_TAB'
  | 'AGENT_PROMPT'
  | 'AGENT_STATUS_UPDATE'
  | 'AGENT_LOG'
  | 'AGENT_CHECKPOINT'
  | 'AGENT_CHECKPOINT_RESPONSE'
  | 'AGENT_WORKFLOW_BATCH'
  | 'WORKFLOW_RUN_STATUS'
  | 'WORKFLOW_STEP_STATUS'
  | 'WORKFLOW_CANCEL'
  | 'TAKEOVER_REQUEST'
  | 'TAKEOVER_RELEASE'
  | 'REMOTE_INPUT_MOUSE'
  | 'REMOTE_INPUT_KEYBOARD'
  | 'BROWSER_ACTION';

export interface DataChannelMessage<T = unknown> {
  type: MessageType;
  version: '1.0';
  timestamp: number;
  id?: string;
  payload: T;
}

// ─── Remote Input Types ────────────────────────────────────────────────────────

export interface RemoteMousePayload {
  action: 'move' | 'down' | 'up' | 'click' | 'scroll';
  xPercent: number;
  yPercent: number;
  button?: 'left' | 'right' | 'middle';
  deltaY?: number;
}

export interface RemoteKeyboardPayload {
  action: 'down' | 'up' | 'press';
  key: string;
}

// ─── IPC API Shape (matches preload contextBridge) ────────────────────────────

export interface DesktopSource {
  id: string;
  name: string;
}

export interface AppDiagnostics {
  browserRunning: boolean;
  agentRunning: boolean;
  workflowRunning: boolean;
  signalingConnected: boolean;
  signalingRole: string | null;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  preferredProvider: string;
  platform: string;
  electronVersion: string;
  nodeVersion: string;
  appVersion: string;
}

export interface RemoteCtrlAPI {
  app: {
    getDiagnostics: () => Promise<AppDiagnostics>;
    showMainWindow: () => Promise<void>;
    hideMiniWindow: () => Promise<void>;
    showMiniWindow: (hideMain?: boolean) => Promise<void>;
  };
  host: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    approveController: (controllerId: string) => Promise<void>;
    rejectController: (controllerId: string) => Promise<void>;
  };
  controller: {
    connect: (pin: string) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  browser: {
    launch: (startUrl?: string) => Promise<string>;  // returns window title
    close: () => Promise<void>;
    getSources: () => Promise<DesktopSource[]>;
    resetProfile: () => Promise<void>;
    injectMouse: (payload: RemoteMousePayload) => Promise<void>;
    injectKeyboard: (payload: RemoteKeyboardPayload) => Promise<void>;
    startAgent: (payload: AgentPromptPayload) => Promise<{ ok: boolean; error?: string }>;
    rewindAndRerunAgent: (payload: AgentRewindPayload) => Promise<{ ok: boolean; error?: string }>;
    cancelAgent: () => Promise<{ ok: boolean }>;
    startWorkflow: (payload: AgentWorkflowBatchPayload) => Promise<{ ok: boolean; error?: string }>;
    cancelWorkflow: () => Promise<{ ok: boolean }>;
    setTakeoverActive: (active: boolean) => Promise<{ ok: boolean }>;
    getTabs: () => Promise<TabInfo[]>;
    switchTab: (tabId: string) => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    reload: () => Promise<void>;
    navigate: (url: string) => Promise<void>;
    closeTab: (tabId: string) => Promise<void>;
    newTab: () => Promise<void>;
    submitCheckpoint: (checkpointId: string, response: CheckpointResponse) => Promise<void>;
  };
  webrtc: {
    sendSignal: (signal: unknown) => Promise<void>;
  };
  settings: {
    hasApiKey: (provider: ApiProvider) => Promise<boolean>;
    setApiKey: (provider: ApiProvider, value: string) => Promise<void>;
    getSignalingUrl: () => Promise<string>;
    setSignalingUrl: (url: string) => Promise<void>;
    getPreferredProvider: () => Promise<ApiProvider>;
    setPreferredProvider: (provider: ApiProvider) => Promise<void>;
    getPreferredModel: () => Promise<string | undefined>;
    setPreferredModel: (model: string) => Promise<void>;
    fetchModels: (provider: ApiProvider) => Promise<string[]>;
    getAvailableModels: (provider: ApiProvider) => Promise<string[]>;
    getBrowserMode: () => Promise<BrowserMode>;
    setBrowserMode: (mode: BrowserMode) => Promise<void>;
    getHeadlessMode: () => Promise<boolean>;
    setHeadlessMode: (headless: boolean) => Promise<void>;
    getKeepBrowserOpenOnQuit: () => Promise<boolean>;
    setKeepBrowserOpenOnQuit: (keepOpen: boolean) => Promise<void>;
    getBrowserProfile: () => Promise<string>;
    setBrowserProfile: (profile: string) => Promise<void>;
    getCustomProfiles: () => Promise<string[]>;
    addCustomProfile: (name: string) => Promise<void>;
    deleteCustomProfile: (name: string) => Promise<void>;
    getUseVisionCUA: () => Promise<boolean>;
    setUseVisionCUA: (useCua: boolean) => Promise<void>;
    getCustomBaseUrl: (provider: ApiProvider) => Promise<string | undefined>;
    setCustomBaseUrl: (provider: ApiProvider, url?: string) => Promise<void>;
    getTheme: () => Promise<AppTheme>;
    setTheme: (theme: AppTheme) => Promise<void>;
    getGlobalShortcut: () => Promise<string>;
    setGlobalShortcut: (shortcut: string) => Promise<void>;
  };
  workflows: {
    list: () => Promise<LocalWorkflow[]>;
    save: (workflow: LocalWorkflow) => Promise<void>;
    delete: (workflowId: string) => Promise<void>;
  };
  // Event listeners (Main -> Renderer push events)
  on: {
    hostStateChange: (cb: (state: HostSessionState) => void) => () => void;
    controllerStateChange: (cb: (state: ControllerSessionState) => void) => () => void;
    controllerJoinRequest: (cb: (controllerId: string) => void) => () => void;
    agentStatus: (cb: (payload: AgentStatusPayload) => void) => () => void;
    agentLog: (cb: (payload: AgentLogPayload) => void) => () => void;
    pin: (cb: (pin: string) => void) => () => void;
    workflowRecordedStep: (cb: (step: any) => void) => () => void;
    error: (cb: (message: string) => void) => () => void;
    webrtcSignal: (cb: (signal: unknown) => void) => () => void;
    captureMetadata: (cb: (meta: CaptureMetadata) => void) => () => void;
    windowTitle: (cb: (title: string) => void) => () => void;
    workflowRunStatus: (cb: (status: WorkflowRunStatus) => void) => () => void;
    workflowStepStatus: (cb: (status: WorkflowStepStatus) => void) => () => void;
    tabsChange: (cb: (tabs: TabInfo[]) => void) => () => void;
    screencastFrame: (cb: (frameData: Uint8Array) => void) => () => void;
    agentCheckpoint: (cb: (payload: AgentCheckpointPayload) => void) => () => void;
    openSettings: (cb: () => void) => () => void;
    firstLaunch: (cb: () => void) => () => void;
    startLocalSession: (cb: () => void) => () => void;
    globalShortcut: (cb: () => void) => () => void;
  };
}

// Extend Window to include RemoteCtrlAPI
declare global {
  interface Window {
    RemoteCtrlAPI: RemoteCtrlAPI;
  }
}
