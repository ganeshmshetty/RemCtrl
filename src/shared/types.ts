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

export type StepPostcondition =
  | { kind: 'url_includes'; value: string }
  | { kind: 'selector_visible'; value: string }
  | { kind: 'text_visible'; value: string }
  | { kind: 'field_value'; selector: string; value: string }
  | { kind: 'selected_value'; selector: string; value: string };

export type BaseStep = {
  id: string;
  onFailure: 'stop' | 'skip' | 'retry' | 'self_heal';
  /** Plain-language explanation used for logs, previews, and recovery. */
  description?: string;
  /** Deterministic check run after the step; never an additional AI call. */
  postcondition?: StepPostcondition;
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

export interface ExecutionTraceEntry {
  id: string;
  sequence: number;
  timestamp: number;
  tool: string;
  input: Record<string, unknown>;
  semanticDescription: string;
  status: 'succeeded' | 'blocked' | 'failed' | 'skipped';
  resolvedSelector?: string;
  urlBefore?: string;
  urlAfter?: string;
  targetLabel?: string;
  error?: string;
}

export interface LocalWorkflow {
  id: string;
  name: string;
  description?: string;
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
export type SpeechInputMode = 'push_to_talk' | 'hands_free';

export interface AppSettings {
  signalingUrl: string;
  preferredProvider: ApiProvider;
  preferredModel?: string;
  customBaseUrls?: Record<string, string>;
  browserMode: BrowserMode;
  theme: AppTheme;
  speechToTextEnabled?: boolean;
  speechInputMode?: SpeechInputMode;
  // API keys are NOT stored in renderer — Main process holds them
}

// ─── Scoped Action Policy Types ──────────────────────────────────────────────

export interface PolicyRuleSet {
  allow: string[];
  deny: string[];
}

export interface PolicyLimits {
  maxPendingApprovals: number;
  approvalTtlMs: number;
  maxAuditEvents: number;
}

/** The complete policy currently applied by the main-process policy gate. */
export interface PolicyScope {
  id: string;
  sessionId?: string;
  actorId?: string;
  capabilities: PolicyRuleSet;
  origins: PolicyRuleSet;
  domains: PolicyRuleSet;
  paths: PolicyRuleSet;
  /** Capability patterns that are allowed only after an explicit approval. */
  requireApproval: string[];
  limits: PolicyLimits;
}

/** An action request is intentionally data-only so it can cross process seams safely. */
export interface PolicyIntent {
  sessionId: string;
  actorId: string;
  action: string;
  capability: string;
  url?: string;
  origin?: string;
  domain?: string;
  path?: string;
  approvalId?: string;
  payload?: unknown;
}

/** The command used to resolve a pending approval. */
export type PolicyApprovalDecision = 'approve' | 'deny' | 'cancel';

export type PolicyApprovalStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired' | 'used';

export interface PolicyApproval {
  id: string;
  sessionId: string;
  actorId: string;
  actionDigest: string;
  capability: string;
  createdAt: number;
  expiresAt: number;
  status: PolicyApprovalStatus;
  decision?: PolicyApprovalDecision;
  resolvedAt?: number;
  usedAt?: number;
}

/** UI-safe view of an action paused at the main-process policy seam. */
export interface PolicyApprovalRequest {
  approval: PolicyApproval;
  action: string;
  capability: string;
  url?: string;
}

export interface PolicyAuditResource {
  origin?: string;
  domain?: string;
  path?: string;
}

export type PolicyAuditKind =
  | 'scope_set'
  | 'authorization'
  | 'approval_resolved'
  | 'approval_expired'
  | 'session_cancelled';

export type PolicyAuditOutcome = 'allowed' | 'denied' | 'pending' | 'approved' | 'cancelled' | 'expired';

/** Audit records never contain the raw intent or payload; only normalized/redacted fields. */
export interface ScopedPolicyAuditEvent {
  id: string;
  timestamp: number;
  kind: PolicyAuditKind;
  outcome: PolicyAuditOutcome;
  scopeId?: string;
  sessionId?: string;
  actorId?: string;
  capability?: string;
  actionDigest?: string;
  approvalId?: string;
  decision?: PolicyApprovalDecision;
  reasonCodes: string[];
  resource?: PolicyAuditResource;
}

export type PolicyAuthorizationStatus = 'allowed' | 'denied' | 'pending';

export interface PolicyAuthorization {
  status: PolicyAuthorizationStatus;
  actionDigest: string;
  approval?: PolicyApproval;
  reasonCodes: string[];
  auditEvent: ScopedPolicyAuditEvent;
}

// Compatibility contracts for the existing automation and IPC seams.
export type ActionCapability =
  | 'browser.read' | 'browser.navigate' | 'browser.click' | 'browser.type'
  | 'browser.keypress' | 'browser.scroll' | 'browser.tab';
export type ActionSource = 'agent' | 'workflow' | 'remote-human' | 'local-ui' | 'extension';

export interface TaskScope {
  id: string;
  name: string;
  /** The user-declared outcome. The gate refuses actions until this is set. */
  goal: string;
  /** Domain matching is opt-in; an empty domain restriction keeps the browser open-ended. */
  domainRestrictionEnabled: boolean;
  allowedDomains: string[];
  requireApprovalFor: ActionCapability[];
  maxActions: number;
  expiresAt?: number;
}

export interface ActionIntent {
  sessionId: string;
  source: ActionSource;
  actorId: string;
  capability: ActionCapability;
  url?: string;
  target?: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface PolicyDecision {
  decision: 'allowed' | 'blocked' | 'approved';
  reason: string;
  approvalId?: string;
}

export interface PolicyAuditEvent {
  id: string;
  timestamp: number;
  type: 'scope.changed' | 'action.requested' | 'action.allowed' | 'action.blocked' | 'approval.requested' | 'approval.resolved';
  sessionId: string;
  capability?: ActionCapability;
  target?: string;
  reason?: string;
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
  /** Stable renderer/session scope used to isolate multi-turn model context. */
  sessionId?: string;
  action: AgentAction;
  instruction: string;
  /** Local sessions are owned by the current user and do not use remote scope enforcement. */
  executionMode?: 'local' | 'remote';
  /** Active explicit recording session to which successful traces are appended. */
  recordingSessionId?: string;
  /** @deprecated Use an explicit recording session and save action instead. */
  recordWorkflow?: { name: string; description: string };
}

export interface RecordingSessionState {
  id: string;
  status: 'recording' | 'saving';
  initialInstruction: string;
  capturedStepCount: number;
  promptCount: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface AgentRewindPayload {
  snapshotId: string;
  commandId: string;
  sessionId?: string;
  action: 'act' | 'observe' | 'extract' | 'clipboard_read' | 'clipboard_write' | 'invoke_mcp' | 'playwright_action';
  newInstruction: string;
  executionMode?: 'local' | 'remote';
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
  commandId?: string;
  phase?: 'started' | 'completed' | 'failed';
}

export interface AgentActivityEntry {
  id: string;
  text: string;
  state: 'running' | 'completed' | 'failed';
  timestamp: number;
  completedAt?: number;
  durationMs?: number;
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
  chatHistory: AutomationRunChatMessage[];
  error?: string;
}

export type AutomationCheckpointStatus = 'running' | 'paused' | 'failed' | 'interrupted';

/** Minimal, redacted metadata for recovering a run after renderer/main restart. */
export interface AutomationRunCheckpoint {
  id: string;
  kind: 'agent' | 'workflow';
  commandId: string;
  workflowId?: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  status: AutomationCheckpointStatus;
  currentStep?: number;
  currentAction?: string;
  completedSteps?: number;
  error?: string;
}

/** A serialisable chat entry stored with a local automation session. */
export interface AutomationRunChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'warn' | 'error' | 'workflow' | 'checkpoint';
  text: string;
  timestamp: number;
  checkpointPayload?: AgentCheckpointPayload;
  activity?: AgentActivityEntry[];
  isFinal?: boolean;
}

// ─── Workflow Run Types ────────────────────────────────────────────────────────

export interface AgentWorkflowBatchPayload {
  workflowRunId: string;
  workflowId: string;
  name: string;
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
  | 'TAKEOVER_DECISION'
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
    setIgnoreMouseEvents: (ignore: boolean) => Promise<void>;
    resizeToContent: (contentHeight: number) => Promise<void>;
  };
  host: {
    start: (options?: { trusted?: boolean }) => Promise<void>;
    stop: () => Promise<void>;
    approveController: (controllerId: string, intent: string) => Promise<void>;
    rejectController: (controllerId: string) => Promise<void>;
  };
  controller: {
    connect: (pin: string, intent: string) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  browser: {
    launch: (startUrl?: string) => Promise<string>;  // returns window title
    launchRecording: () => Promise<string>;
    startWorkflowRecording: (payload?: { initialInstruction?: string }) => Promise<{ ok: boolean; state?: RecordingSessionState; error?: string }>;
    getWorkflowRecording: () => Promise<RecordingSessionState | null>;
    saveWorkflowRecording: () => Promise<{ ok: boolean; workflow?: LocalWorkflow; error?: string }>;
    discardWorkflowRecording: () => Promise<{ ok: boolean; error?: string }>;
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
    getSpeechToTextEnabled: () => Promise<boolean>;
    setSpeechToTextEnabled: (enabled: boolean) => Promise<void>;
    getSpeechInputMode: () => Promise<SpeechInputMode>;
    setSpeechInputMode: (mode: SpeechInputMode) => Promise<void>;
  };
  workflows: {
    list: () => Promise<LocalWorkflow[]>;
    save: (workflow: LocalWorkflow) => Promise<void>;
    delete: (workflowId: string) => Promise<void>;
  };
  agent: {
    /** Clears transient model context only; saved session history is separate. */
    clearHistory: (sessionId?: string) => Promise<{ ok: boolean }>;
    listRecoverableRuns: () => Promise<AutomationRunCheckpoint[]>;
    discardRecoverableRun: (id: string) => Promise<{ ok: boolean }>;
    resumeRecoverableRun: (id: string) => Promise<{ ok: boolean; error?: string }>;
    listRunHistory: () => Promise<AutomationRunHistoryItem[]>;
    saveRunHistory: (item: AutomationRunHistoryItem) => Promise<{ ok: boolean; error?: string }>;
    deleteRunHistory: (id: string) => Promise<{ ok: boolean }>;
    clearRunHistory: () => Promise<{ ok: boolean }>;
  };
  policy: {
    getScope: () => Promise<TaskScope>;
    setScope: (scope: TaskScope) => Promise<{ ok: boolean; error?: string }>;
    approve: (approvalId: string, approved: boolean) => Promise<{ ok: boolean; error?: string }>;
    getAudit: () => Promise<PolicyAuditEvent[]>;
  };
  // Event listeners (Main -> Renderer push events)
  on: {
    hostStateChange: (cb: (state: HostSessionState) => void) => () => void;
    controllerStateChange: (cb: (state: ControllerSessionState) => void) => () => void;
    controllerJoinRequest: (cb: (request: { controllerId: string; intent: string }) => void) => () => void;
    agentStatus: (cb: (payload: AgentStatusPayload) => void) => () => void;
    agentLog: (cb: (payload: AgentLogPayload) => void) => () => void;
    pin: (cb: (pin: string) => void) => () => void;
    workflowRecordedStep: (cb: (step: WorkflowStep) => void) => () => void;
    workflowCreated: (cb: () => void) => () => void;
    workflowRecordingState: (cb: (state: RecordingSessionState | null) => void) => () => void;
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
    themeChanged: (cb: (theme: string) => void) => () => void;
    agentStarted: (cb: (payload: { commandId: string; instruction: string }) => void) => () => void;
    policyApprovalRequested: (cb: (approval: PolicyApprovalRequest) => void) => () => void;
    policyAudit: (cb: (event: PolicyAuditEvent) => void) => () => void;
  };
}

// Extend Window to include RemoteCtrlAPI
declare global {
  interface Window {
    RemoteCtrlAPI: RemoteCtrlAPI;
  }
}
