/**
 * @file schemas.ts
 * @description Centralized validation layer defining Zod schemas for configurations, IPC payloads, settings, workflows, and remote-control actions.
 * @module shared/schemas
 * 
 * Key Exports:
 * - Workflow step validation: `WorkflowStepSchema`, `LocalWorkflowSchema`, and enum schemas for step types.
 * - Settings schemas: `PersistedSettingsSchema` (excluding secure API keys), `AppThemeSchema`, and provider schemas.
 * - Ext-server payloads: `ExtSaveWorkflowPayloadSchema`, `ExtStartAutomationPayloadSchema`, and run payload schemas.
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
  startUrl: z.string().max(2048).optional(),
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

export const ExtSaveWorkflowPayloadSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  startUrl: z.string().optional(),
  steps: z.array(WorkflowStepSchema).optional(),
});

export const ExtStartAutomationPayloadSchema = z.object({
  url: z.string().optional(),
  instruction: z.string().min(1),
});

export const ExtRunWorkflowPayloadSchema = z.object({
  workflowId: z.string().min(1),
});

// ─── Host IPC Schemas ─────────────────────────────────────────────────────────

export const ApproveControllerSchema = z.object({
  controllerId: z.string().min(1),
});

// ─── Controller IPC Schemas ───────────────────────────────────────────────────

export const ConnectPinSchema = z.object({
  pin: z.string().length(9).regex(/^\d{9}$/),
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
  action: AgentActionSchema,
  instruction: z.string().min(1).max(5000),
  variables: z.record(z.string(), z.string()).optional(),
});

export const AgentRewindPayloadSchema = z.object({
  snapshotId: z.string().min(1),
  commandId: z.string().uuid(),
  action: AgentActionSchema,
  newInstruction: z.string().min(1).max(5000),
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
  startUrl: z.string().optional(),
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
  // API keys are stored in a separate secure store — not in this file
});

export type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;
