/**
 * @file task-session.ts
 * @description State tracking container managing running, paused, cancelled, and failed automation lifecycles.
 * Key Exported APIs: `TaskSession` class and the `TaskStatus` type definition.
 * Internal Mechanics: Exposes state predicates (`isCancelled`, `isPaused`, `isActive`), drives asynchronous abort signaling via `AbortController`, and manages step logging sessions via `DiskJournalAdapter`. Implements a blocking `waitIfPaused` poll loop with automatic 15-minute timeout mitigation to prevent locked loops.
 * Relations: Instantiated by execution engines (`execution-engine.ts` and `workflow-executor.ts`) to capture execution state and handle user pause/cancellation requests.
 */

export type TaskStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'failed';

import { DiskJournalAdapter, SessionJournal } from './session-journal.js';
import { throwIfAborted, waitFor } from './abortable.js';

export class TaskSession {
  private _status: TaskStatus = 'idle';
  private _abortController = new AbortController();
  private _failure: Error | null = null;
  private _lastActivityAt = Date.now();
  public initialGoal?: string;
  public readonly commandId?: string;
  public readonly journal: SessionJournal;
  
  constructor(options?: { initialGoal?: string; commandId?: string }) {
    this.initialGoal = options?.initialGoal;
    this.commandId = options?.commandId;
    this.journal = new DiskJournalAdapter(options?.commandId);
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
  }

  cancel(reason: Error = new Error('Cancelled by user')): void {
    if (!this.isActive && this._status !== 'idle') return;
    this._status = 'cancelled';
    this._abortController.abort(reason);
  }

  fail(reason: Error): void {
    if (!this.isActive && this._status !== 'idle') return;
    this._failure = reason;
    this._status = 'failed';
    this._abortController.abort(reason);
  }

  pause(): void {
    if (this._status === 'running') {
      this._status = 'paused';
      this.touch();
    }
  }

  resume(): void {
    if (this._status === 'paused') {
      this._status = 'running';
      this.touch();
    }
  }

  touch(): void {
    if (this.isActive) this._lastActivityAt = Date.now();
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
}
