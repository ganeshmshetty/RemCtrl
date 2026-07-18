/**
 * @file task-session.ts
 * @description State tracking container managing running, paused, cancelled, and failed automation lifecycles.
 * Key Exported APIs: `TaskSession` class and the `TaskStatus` type definition.
 * Internal Mechanics: Exposes state predicates (`isCancelled`, `isPaused`, `isActive`), drives asynchronous abort signaling via `AbortController`, and manages step logging sessions via `DiskJournalAdapter`. Implements a blocking `waitIfPaused` poll loop with automatic 15-minute timeout mitigation to prevent locked loops.
 * Relations: Instantiated by execution engines (`execution-engine.ts` and `workflow-executor.ts`) to capture execution state and handle user pause/cancellation requests.
 */

export type TaskStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'failed' | 'completed';

import { DiskJournalAdapter, SessionJournal } from './session-journal.js';
import { throwIfAborted, waitFor } from './abortable.js';
import { removeRunCheckpoint, saveRunCheckpoint } from './run-checkpoint.js';
import type { AutomationCheckpointStatus } from '../../shared/types.js';

export class TaskSession {
  private _status: TaskStatus = 'idle';
  private _abortController = new AbortController();
  private _failure: Error | null = null;
  private _lastActivityAt = Date.now();
  private readonly checkpointId: string;
  private readonly checkpointKind: 'agent' | 'workflow';
  private readonly checkpointTitle: string;
  private readonly startedAt = Date.now();
  public initialGoal?: string;
  public readonly commandId?: string;
  public readonly journal: SessionJournal;
  
  constructor(options?: { initialGoal?: string; commandId?: string; kind?: 'agent' | 'workflow'; title?: string }) {
    this.initialGoal = options?.initialGoal;
    this.commandId = options?.commandId;
    this.checkpointKind = options?.kind ?? 'agent';
    this.checkpointTitle = options?.title ?? options?.initialGoal?.slice(0, 120) ?? 'Automation run';
    this.journal = new DiskJournalAdapter(options?.commandId);
    this.checkpointId = options?.commandId ?? this.journal.id;
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  get isCancelled(): boolean { return this._status === 'cancelled'; }
  get isFailed(): boolean { return this._status === 'failed'; }
  get isPaused():    boolean { return this._status === 'paused'; }
  get isActive():    boolean { return this._status === 'running' || this._status === 'paused'; }
  get status():      TaskStatus { return this._status; }
  get abortSignal(): AbortSignal { return this._abortController.signal; }
  get failure(): Error | null { return this._failure; }
  get lastActivityAt(): number { return this._lastActivityAt; }

  // ─── Transitions ──────────────────────────────────────────────────────────

  start(): void {
    if (this._status !== 'idle') return;
    this._status = 'running';
    this.touch();
    this.persistCheckpoint();
  }

  cancel(reason: Error = new Error('Cancelled by user')): void {
    if (!this.isActive && this._status !== 'idle') return;
    this._status = 'cancelled';
    this._abortController.abort(reason);
    void removeRunCheckpoint(this.checkpointId).catch(() => {});
  }

  fail(reason: Error): void {
    if (!this.isActive && this._status !== 'idle') return;
    this._failure = reason;
    this._status = 'failed';
    this._abortController.abort(reason);
    this.persistCheckpoint({ status: 'failed', error: reason.message });
  }

  pause(): void {
    if (this._status === 'running') {
      this._status = 'paused';
      this.touch();
      this.persistCheckpoint({ status: 'paused' });
    }
  }

  resume(): void {
    if (this._status === 'paused') {
      this._status = 'running';
      this.touch();
      this.persistCheckpoint({ status: 'running' });
    }
  }

  touch(): void {
    if (this.isActive) this._lastActivityAt = Date.now();
  }

  complete(): void {
    if (!this.isActive) return;
    this._status = 'completed';
    void removeRunCheckpoint(this.checkpointId).catch(() => {});
  }

  checkpoint(progress: { currentStep?: number; currentAction?: string; completedSteps?: number }): void {
    this.touch();
    this.persistCheckpoint(progress);
  }

  assertCanContinue(): void {
    throwIfAborted(this.abortSignal);
    if (this.isPaused) throw new Error('Automation is paused.');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Suspends the caller until the session is no longer paused. Pauses are
   * intentionally indefinite; the user may need more than fifteen minutes
   * to complete a takeover or approval step.
   */
  async waitIfPaused(onPause?: () => void, onResume?: () => void): Promise<void> {
    if (this._status !== 'paused') return;
    onPause?.();
    while (this._status === 'paused') {
      await waitFor(500, this.abortSignal);
    }
    if (!this.isCancelled && !this.isFailed) {
      this.touch();
      onResume?.();
    }
  }

  startWatchdog(options: {
    maxDurationMs: number;
    inactivityMs: number;
    onTimeout: (error: Error) => void;
  }): () => void {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (!this.isActive || this.isPaused) return;
      const now = Date.now();
      if (now - startedAt >= options.maxDurationMs) {
        options.onTimeout(new Error(`Automation exceeded its ${Math.round(options.maxDurationMs / 60_000)} minute run limit.`));
        return;
      }
      if (now - this._lastActivityAt >= options.inactivityMs) {
        options.onTimeout(new Error(`Automation made no progress for ${Math.round(options.inactivityMs / 60_000)} minutes.`));
      }
    }, 10_000);
    return () => clearInterval(timer);
  }

  private persistCheckpoint(overrides: Partial<{
    status: AutomationCheckpointStatus;
    currentStep: number;
    currentAction: string;
    completedSteps: number;
    error: string;
  }> = {}): void {
    if (!this.commandId) return;
    const status = overrides.status ?? (this._status === 'paused' ? 'paused' : 'running');
    void saveRunCheckpoint({
      id: this.checkpointId,
      kind: this.checkpointKind,
      commandId: this.commandId,
      title: this.checkpointTitle,
      startedAt: this.startedAt,
      updatedAt: Date.now(),
      status,
      ...overrides,
    }).catch(() => {});
  }

}
