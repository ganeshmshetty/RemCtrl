/**
 * @file schemas.ts
 * @description Centralized validation layer defining Zod schemas for configurations, IPC payloads, settings, workflows, and remote-control actions.
 * @module shared/schemas
 * 
 * Key Exports:
 * - Workflow step validation: `WorkflowStepSchema`, `LocalWorkflowSchema`, and enum schemas for step types.
 * - Settings schemas: `PersistedSettingsSchema` (excluding secure API keys), `AppThemeSchema`, and provider schemas.
 * - Extension import payloads: `ExtSaveWorkflowPayloadSchema`.
 * - IPC/Remote: `RemoteMousePayloadSchema`, `RemoteKeyboardPayloadSchema`, `ConnectPinSchema`, and `ApproveControllerSchema`.
 * 
 * Mechanics & Relations:
 * - Acts as the validation gatekeeper across the system, ensuring data integrity for JSON persistence in `storage.ts`.
 * - Validates messages arriving over WebSockets via `signaling-client.ts` and incoming API requests from browser extensions in `ext-server.ts`.
 * - Provides compile-time TypeScript type definitions inferred from runtime validation constraints.
 */

import { z } from 'zod';

// ─── Workflow Schemas ──────────────────────────────────────────────────────────

export const StepTypeSchema = z.enum(['navigate', 'click', 'fill', 'select', 'keypress', 'wait', 'extract', 'check']);

const BaseStepSchema = z.object({
  id: z.string().min(1),
  onFailure: z.enum(['stop', 'skip', 'retry', 'self_heal']).optional().default('self_heal'),
  description: z.string().min(1).max(500).optional(),
  postcondition: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('url_includes'), value: z.string().min(1) }),
    z.object({ kind: z.literal('selector_visible'), value: z.string().min(1) }),
    z.object({ kind: z.literal('text_visible'), value: z.string().min(1) }),
    z.object({ kind: z.literal('field_value'), selector: z.string().min(1), value: z.string() }),
    z.object({ kind: z.literal('selected_value'), selector: z.string().min(1), value: z.string() }),
  ]).optional(),
});

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  BaseStepSchema.extend({ type: z.literal('navigate'), url: z.string() }),
  BaseStepSchema.extend({ type: z.literal('click'), selector: z.string().min(1), description: z.string().optional() }),
  BaseStepSchema.extend({ type: z.literal('fill'), selector: z.string().min(1), value: z.string(), description: z.string().optional() }),
  BaseStepSchema.extend({ type: z.literal('select'), selector: z.string().min(1), value: z.string(), description: z.string().optional() }),
  BaseStepSchema.extend({ type: z.literal('keypress'), key: z.string() }),
  BaseStepSchema.extend({ type: z.literal('wait'), ms: z.number() }),
  BaseStepSchema.extend({ type: z.literal('extract'), instruction: z.string() }),
  BaseStepSchema.extend({ type: z.literal('check'), condition: z.string(), onTrue: z.string().optional(), onFalse: z.string().optional() }),
]);

export const LocalWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  steps: z.array(WorkflowStepSchema).max(100),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  source: z.enum(['ai_recorded', 'chrome_ext', 'manual']).optional(),
});

// ─── Settings Schemas ─────────────────────────────────────────────────────────

export const AppThemeSchema = z.enum(['light', 'dark', 'system']);

export const ApiProviderSchema = z.enum(['openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'nebius', 'openrouter', 'vertex']);

export const SetApiKeySchema = z.object({
  provider: ApiProviderSchema,
  value: z.string().min(1).max(500),
});

export const SetSignalingUrlSchema = z.object({
  url: z.string().url(),
});

export const SetPreferredProviderSchema = z.object({
  provider: ApiProviderSchema,
});

export const SetPreferredModelSchema = z.object({
  model: z.string().min(1).max(200),
});

export const SetCustomBaseUrlSchema = z.object({
  provider: ApiProviderSchema,
  url: z.string().url().optional(),
});

export const SetThemeSchema = z.object({
  theme: AppThemeSchema,
});

export const SetGlobalShortcutSchema = z.object({
  shortcut: z.string().min(1).max(100),
});

// ─── Scoped Action Policy Schemas ────────────────────────────────────────────

const PolicyRuleSetSchema = z.object({
  allow: z.array(z.string().trim().min(1).max(256)).max(128).default([]),
  deny: z.array(z.string().trim().min(1).max(256)).max(128).default([]),
}).strict();

export const PolicyLimitsSchema = z.object({
  maxPendingApprovals: z.number().int().min(1).max(100).default(20),
  approvalTtlMs: z.number().int().min(1_000).max(15 * 60 * 1_000).default(5 * 60 * 1_000),
  maxAuditEvents: z.number().int().min(1).max(10_000).default(1_000),
}).strict();

export const PolicyScopeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128).optional(),
  actorId: z.string().trim().min(1).max(128).optional(),
  capabilities: PolicyRuleSetSchema.default({ allow: [], deny: [] }),
  origins: PolicyRuleSetSchema.default({ allow: [], deny: [] }),
  domains: PolicyRuleSetSchema.default({ allow: [], deny: [] }),
  paths: PolicyRuleSetSchema.default({ allow: [], deny: [] }),
  requireApproval: z.array(z.string().trim().min(1).max(256)).max(128).default([]),
  limits: PolicyLimitsSchema.default({
    maxPendingApprovals: 20,
    approvalTtlMs: 5 * 60 * 1_000,
    maxAuditEvents: 1_000,
  }),
}).strict();

export const PolicyIntentSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  actorId: z.string().trim().min(1).max(128),
  action: z.string().trim().min(1).max(128),
  capability: z.string().trim().min(1).max(256),
  url: z.string().trim().min(1).max(4_096).optional(),
  origin: z.string().trim().min(1).max(2_048).optional(),
  domain: z.string().trim().min(1).max(512).optional(),
  path: z.string().trim().min(1).max(4_096).optional(),
  approvalId: z.string().uuid().optional(),
  payload: z.unknown().optional(),
}).strict();

export const PolicyDecisionSchema = z.enum(['approve', 'deny', 'cancel']);

export const PolicyApprovalSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().min(1).max(128),
  actorId: z.string().min(1).max(128),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  capability: z.string().min(1).max(256),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  status: z.enum(['pending', 'approved', 'denied', 'cancelled', 'expired', 'used']),
  decision: PolicyDecisionSchema.optional(),
  resolvedAt: z.number().int().nonnegative().optional(),
  usedAt: z.number().int().nonnegative().optional(),
}).strict();

const PolicyAuditResourceSchema = z.object({
  origin: z.string().max(2_048).optional(),
  domain: z.string().max(512).optional(),
  path: z.string().max(4_096).optional(),
}).strict();

export const PolicyAuditEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number().int().nonnegative(),
  kind: z.enum(['scope_set', 'authorization', 'approval_resolved', 'approval_expired', 'session_cancelled']),
  outcome: z.enum(['allowed', 'denied', 'pending', 'approved', 'cancelled', 'expired']),
  scopeId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
  actorId: z.string().max(128).optional(),
  capability: z.string().max(256).optional(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  approvalId: z.string().uuid().optional(),
  decision: PolicyDecisionSchema.optional(),
  reasonCodes: z.array(z.string().min(1).max(128)).max(32),
  resource: PolicyAuditResourceSchema.optional(),
}).strict();

export const ExtSaveWorkflowPayloadSchema = z.object({
  /** Stable id makes reconnect retries idempotent. */
  id: z.string().min(1),
  requestId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(100),
});

// ─── Host IPC Schemas ─────────────────────────────────────────────────────────

export const ApproveControllerSchema = z.object({
  controllerId: z.string().min(1),
});

// ─── Controller IPC Schemas ───────────────────────────────────────────────────

export const ConnectPinSchema = z.object({
  pin: z.string().length(9).regex(/^\d{9}$/),
  intent: z.string().trim().min(8).max(1000),
});

export const StartHostSchema = z.object({
  trusted: z.boolean().default(false),
});

// ─── Agent Schemas ────────────────────────────────────────────────────────────

export const CheckpointResponseSchema = z.object({
  selectedOptionId: z.string().min(1),
  customInput: z.string().optional(),
});

// AgentAction is separate from StepType (agent panel uses act/observe/extract)
const AgentActionSchema = z.enum(['act', 'observe', 'extract', 'clipboard_read', 'clipboard_write', 'invoke_mcp', 'playwright_action']);

export const AgentPromptPayloadSchema = z.object({
  commandId: z.string().uuid(),
  sessionId: z.string().min(1).max(120).optional(),
  action: AgentActionSchema,
  instruction: z.string().min(1).max(5000),
  executionMode: z.enum(['local', 'remote']).default('remote'),
  recordingSessionId: z.string().uuid().optional(),
  recordWorkflow: z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().min(8).max(1000) }).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

export const RecordingSessionStartSchema = z.object({
  initialInstruction: z.string().trim().min(1).max(5000).optional(),
}).default({});

export const AgentRewindPayloadSchema = z.object({
  snapshotId: z.string().min(1),
  commandId: z.string().uuid(),
  sessionId: z.string().min(1).max(120).optional(),
  action: AgentActionSchema,
  newInstruction: z.string().min(1).max(5000),
  executionMode: z.enum(['local', 'remote']).default('remote'),
});

export const AgentStatusPayloadSchema = z.object({
  commandId: z.string().uuid(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled', 'paused']),
  result: z.any().optional(),
  error: z.string().optional(),
});

export const AgentWorkflowBatchSchema = z.object({
  workflowRunId: z.string().uuid(),
  workflowId: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(WorkflowStepSchema).min(1).max(100),
});

// ─── Capture Metadata Schema ──────────────────────────────────────────────────

export const CaptureMetadataSchema = z.object({
  captureWidth: z.number().positive(),
  captureHeight: z.number().positive(),
  viewportWidth: z.number().positive(),
  viewportHeight: z.number().positive(),
  deviceScaleFactor: z.number().positive(),
  contentRect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});

// ─── Remote Input Schemas ─────────────────────────────────────────────────────

export const RemoteMousePayloadSchema = z.object({
  action: z.enum(['move', 'down', 'up', 'click', 'scroll']),
  xPercent: z.number().min(0).max(1),
  yPercent: z.number().min(0).max(1),
  button: z.enum(['left', 'right', 'middle']).optional(),
  deltaY: z.number().optional(),
});

export const RemoteKeyboardPayloadSchema = z.object({
  action: z.enum(['down', 'up', 'press']),
  key: z.string().min(1).max(50),
});

export const LaunchBrowserPayloadSchema = z.string().optional();
export const TabIdPayloadSchema = z.string().min(1);
export const NavigatePayloadSchema = z.string().min(1);

export const BrowserModeSchema = z.enum(['internal', 'local_chrome']);
export const SpeechInputModeSchema = z.enum(['push_to_talk', 'hands_free']);

// Compact task declaration used by the renderer; the main policy adapter turns
// it into the richer normalized PolicyScope before evaluating actions.
export const TaskScopeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  goal: z.string().trim().min(8).max(1_000),
  domainRestrictionEnabled: z.boolean().default(false),
  allowedDomains: z.array(z.string().min(1).max(253)).min(1).max(50),
  requireApprovalFor: z.array(z.enum([
    'browser.read', 'browser.navigate', 'browser.click', 'browser.type',
    'browser.keypress', 'browser.scroll', 'browser.tab',
  ])).max(7),
  maxActions: z.number().int().min(1).max(10_000),
  expiresAt: z.number().int().positive().optional(),
});

export const PolicyApprovalResolutionSchema = z.object({
  approvalId: z.string().uuid(),
  approved: z.boolean(),
});

// ─── Persisted Settings File Schema ──────────────────────────────────────────

export const PersistedSettingsSchema = z.object({
  signalingUrl: z.string().url().default('https://remotectrl-signaling.onrender.com'),
  preferredProvider: ApiProviderSchema.default('openai'),
  preferredModel: z.string().optional(),
  customBaseUrls: z.record(z.string(), z.string()).optional(),
  browserMode: BrowserModeSchema.default('internal'),
  headlessMode: z.boolean().default(true),
  keepBrowserOpenOnQuit: z.boolean().default(false),
  useVisionCUA: z.boolean().default(true),
  browserProfile: z.string().default('default'),
  customProfiles: z.array(z.string()).default([]),
  theme: AppThemeSchema.default('system'),
  profileInitialized: z.boolean().default(false),
  globalShortcut: z.string().default('CommandOrControl+Shift+Space'),
  speechToTextEnabled: z.boolean().default(true),
  speechInputMode: SpeechInputModeSchema.default('push_to_talk'),
  // API keys are stored in a separate secure store — not in this file
});

export type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;
