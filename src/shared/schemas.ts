import { z } from 'zod';

// ─── Workflow Schemas ──────────────────────────────────────────────────────────

export const StepTypeSchema = z.enum(['navigate', 'do', 'collect', 'check']);

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  type: StepTypeSchema,
  // navigate
  url: z.string().optional(),
  // do, collect, check
  instruction: z.string().optional(),
  // check branching — step IDs
  onTrue: z.string().optional(),
  onFalse: z.string().optional(),
  // recovery policy
  onFailure: z.enum(['stop', 'skip']),
}).refine(
  (s) => {
    if (s.type === 'navigate') return !!s.url;
    if (s.type === 'do' || s.type === 'collect' || s.type === 'check') return !!s.instruction;
    return true;
  },
  { message: 'navigate requires url; do/collect/check require instruction' },
);

export const LocalWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  startUrl: z.union([z.string().url(), z.literal('')]).optional(),
  steps: z.array(WorkflowStepSchema).max(100),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

// ─── Settings Schemas ─────────────────────────────────────────────────────────

export const ApiProviderSchema = z.enum(['openai', 'anthropic', 'gemini', 'groq', 'deepseek', 'nebius', 'openrouter']);

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

// ─── Host IPC Schemas ─────────────────────────────────────────────────────────

export const ApproveControllerSchema = z.object({
  controllerId: z.string().min(1),
});

// ─── Controller IPC Schemas ───────────────────────────────────────────────────

export const ConnectPinSchema = z.object({
  pin: z.string().length(9).regex(/^\d{9}$/),
});

// ─── Agent Schemas ────────────────────────────────────────────────────────────

// AgentAction is separate from StepType (agent panel uses act/observe/extract)
const AgentActionSchema = z.enum(['act', 'observe', 'extract']);

export const AgentPromptSchema = z.object({
  commandId: z.string().uuid(),
  action: AgentActionSchema,
  instruction: z.string().min(1).max(5000),
});

export const AgentWorkflowBatchSchema = z.object({
  workflowRunId: z.string().uuid(),
  workflowId: z.string().min(1),
  name: z.string().min(1),
  startUrl: z.union([z.string().url(), z.literal('')]).optional(),
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

export const BrowserModeSchema = z.enum(['internal', 'local_chrome']);

// ─── Persisted Settings File Schema ──────────────────────────────────────────

export const PersistedSettingsSchema = z.object({
  signalingUrl: z.string().url().default('https://remotectrl-signaling.onrender.com'),
  preferredProvider: ApiProviderSchema.default('openai'),
  preferredModel: z.string().optional(),
  browserMode: BrowserModeSchema.default('internal'),
  headlessMode: z.boolean().default(true),
  // API keys are stored in a separate secure store — not in this file
});

export type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;
