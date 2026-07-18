/**
 * Explicit, multi-turn workflow recording state.
 *
 * Recording is deliberately separate from an agent run. A run contributes a
 * completed execution trace to this session, while persistence happens only
 * when the user explicitly presses Save. This keeps partial/failed attempts
 * out of the workflow repository and lets a user refine a recording with
 * several prompts.
 */
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import type {
  ApiProvider,
  ExecutionTraceEntry,
  LocalWorkflow,
  RecordingSessionState,
} from '../../shared/types.js';
import { compileWorkflow } from './workflow-compiler.js';
import { resolveModel } from './model-resolver.js';
import {
  getApiKey,
  getPreferredProvider,
  saveWorkflow,
} from '../storage.js';

export type RecordingStateListener = (state: RecordingSessionState | null) => void;

interface RecordingSession {
  state: RecordingSessionState;
  prompts: string[];
  trace: ExecutionTraceEntry[];
}

export interface SaveRecordingResult {
  ok: boolean;
  workflow?: LocalWorkflow;
  error?: string;
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/(password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*[^,; ]+/gi, '$1: [redacted]')
    .replace(/([?&](?:token|secret|password|api[_-]?key)=)[^&#\s]+/gi, '$1[redacted]')
    .trim()
    .slice(0, maxLength);
}

function fallbackMetadata(session: RecordingSession, previewLines: string[]): { name: string; description: string } {
  const firstPrompt = cleanText(session.prompts[0] || session.state.initialInstruction, 80);
  const name = firstPrompt
    ? firstPrompt.charAt(0).toUpperCase() + firstPrompt.slice(1).replace(/[.!?]+$/, '')
    : 'Recorded browser workflow';
  const actions = previewLines.slice(0, 8).join('; ');
  const description = cleanText(
    actions ? `Automates: ${actions}.` : 'A reusable browser workflow recorded from an agent session.',
    1000,
  );
  return { name: name.slice(0, 200), description };
}

function parseMetadata(text: string): { name?: string; description?: string } {
  // Models occasionally wrap JSON in a markdown fence despite the contract.
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') return {};
    const record = parsed as Record<string, unknown>;
    return {
      name: typeof record.name === 'string' ? cleanText(record.name, 200) : undefined,
      description: typeof record.description === 'string' ? cleanText(record.description, 1000) : undefined,
    };
  } catch {
    return {};
  }
}

async function generateMetadata(
  session: RecordingSession,
  previewLines: string[],
): Promise<{ name: string; description: string }> {
  const fallback = fallbackMetadata(session, previewLines);
  try {
    const provider = getPreferredProvider() as ApiProvider;
    const apiKey = getApiKey(provider);
    // Vertex can use ADC without an API key; all other configured providers
    // require a stored key for this optional metadata call.
    if (!apiKey && provider !== 'vertex') return fallback;
    const model = resolveModel(provider, apiKey);
    const generation = generateText({
      model,
      system: '<role>You name reusable browser workflows.</role>\n<rules>Return only valid JSON. Never include credentials, tokens, or private field values.</rules>',
      prompt: `<recorded_workflow>\n<initial_request>${cleanText(session.state.initialInstruction, 1000)}</initial_request>\n<follow_up_requests>${session.prompts.slice(0, 8).map((prompt) => cleanText(prompt, 500)).join('\n')}</follow_up_requests>\n<actions>${previewLines.slice(0, 20).map((line) => cleanText(line, 240)).join('\n')}</actions>\n</recorded_workflow>\nReturn exactly {"name":"short imperative title","description":"one sentence describing the reusable outcome"}.`,
      maxOutputTokens: 180,
    });
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Workflow metadata generation timed out.')), 12_000);
    });
    let result: Awaited<typeof generation>;
    try {
      result = await Promise.race([generation, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
    const parsed = parseMetadata(result.text || '');
    return {
      name: parsed.name || fallback.name,
      description: parsed.description || fallback.description,
    };
  } catch {
    // Saving must remain available when a provider is offline or metadata
    // generation is unavailable. The deterministic fallback is still useful.
    return fallback;
  }
}

class RecordingSessionManager {
  private active: RecordingSession | null = null;
  private listener: RecordingStateListener | undefined;

  setListener(listener: RecordingStateListener): void {
    this.listener = listener;
  }

  getState(): RecordingSessionState | null {
    return this.active ? { ...this.active.state } : null;
  }

  start(initialInstruction = ''): RecordingSessionState {
    if (this.active) throw new Error('A workflow recording is already active.');
    const now = Date.now();
    this.active = {
      state: {
        id: randomUUID(),
        status: 'recording',
        initialInstruction: cleanText(initialInstruction, 5000),
        capturedStepCount: 0,
        promptCount: 0,
        createdAt: now,
        updatedAt: now,
      },
      prompts: [],
      trace: [],
    };
    this.emit();
    return this.getState()!;
  }

  append(sessionId: string, instruction: string, trace: ExecutionTraceEntry[]): boolean {
    if (!this.active || this.active.state.id !== sessionId) return false;
    const succeeded = trace.filter((entry) => entry.status === 'succeeded');
    this.active.prompts.push(cleanText(instruction, 5000));
    this.active.trace.push(...trace);
    this.active.state = {
      ...this.active.state,
      capturedStepCount: this.active.state.capturedStepCount + succeeded.length,
      promptCount: this.active.prompts.length,
      updatedAt: Date.now(),
      error: undefined,
    };
    this.emit();
    return true;
  }

  async save(): Promise<SaveRecordingResult> {
    if (!this.active) return { ok: false, error: 'No workflow recording is active.' };
    const session = this.active;
    session.state = { ...session.state, status: 'saving', error: undefined, updatedAt: Date.now() };
    this.emit();

    try {
      const compilation = compileWorkflow(session.trace);
      const errors = compilation.issues.filter((issue) => issue.severity === 'error');
      if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));

      const metadata = await generateMetadata(session, compilation.previewLines);
      const now = Date.now();
      const workflow: LocalWorkflow = {
        id: randomUUID(),
        name: metadata.name,
        description: metadata.description,
        steps: compilation.steps,
        source: 'ai_recorded',
        createdAt: now,
        updatedAt: now,
      };
      saveWorkflow(workflow);
      this.active = null;
      this.emit();
      return { ok: true, workflow };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session.state = { ...session.state, status: 'recording', error: message, updatedAt: Date.now() };
      this.emit();
      return { ok: false, error: message };
    }
  }

  discard(): void {
    if (!this.active) return;
    this.active = null;
    this.emit();
  }

  private emit(): void {
    this.listener?.(this.getState());
  }
}

export const recordingSession = new RecordingSessionManager();
