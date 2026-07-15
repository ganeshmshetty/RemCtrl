/**
 * @file task-session.ts
 * @description State tracking container managing the running, paused, and cancelled lifecycles of active automation runs.
 * Key Exported APIs: `TaskSession` class and the `TaskStatus` type definition.
 * Internal Mechanics: Exposes state predicates (`isCancelled`, `isPaused`, `isActive`), drives asynchronous abort signaling via `AbortController`, and manages step logging sessions via `DiskJournalAdapter`. Implements a blocking `waitIfPaused` poll loop with automatic 15-minute timeout mitigation to prevent locked loops.
 * Relations: Instantiated by execution engines (`execution-engine.ts` and `workflow-executor.ts`) to capture execution state and handle user pause/cancellation requests.
 */

export type TaskStatus = 'idle' | 'running' | 'paused' | 'cancelled';

import { DiskJournalAdapter, SessionJournal } from './session-journal.js';

export class TaskSession {
  private _status: TaskStatus = 'idle';
  private _abortController = new AbortController();
  public initialGoal?: string;
  public readonly journal: SessionJournal;
  
  constructor(options?: { initialGoal?: string; commandId?: string }) {
    this.initialGoal = options?.initialGoal;
    this.journal = new DiskJournalAdapter(options?.commandId);
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  get isCancelled(): boolean { return this._status === 'cancelled'; }
  get isPaused():    boolean { return this._status === 'paused'; }
  get isActive():    boolean { return this._status === 'running' || this._status === 'paused'; }
  get status():      TaskStatus { return this._status; }
  get abortSignal(): AbortSignal { return this._abortController.signal; }

  // ─── Transitions ──────────────────────────────────────────────────────────

  start():  void { this._status = 'running'; }
  cancel(): void { 
    this._status = 'cancelled';
    this._abortController.abort(new Error('Cancelled by user'));
  }

  pause(): void {
    if (this._status === 'running') this._status = 'paused';
  }

  resume(): void {
    if (this._status === 'paused') this._status = 'running';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Suspends the caller until the session is no longer paused.
   * Returns immediately if not paused. Respects cancellation — if cancelled
   * while paused, exits the wait loop without calling onResume.
   */
  async waitIfPaused(onPause?: () => void, onResume?: () => void): Promise<void> {
    if (this._status !== 'paused') return;
    onPause?.();
    const timeoutMs = 15 * 60 * 1000; // 15 minutes
    const start = Date.now();
    while (this._status === 'paused') {
      if (Date.now() - start > timeoutMs) {
        console.warn('[TaskSession] Paused for over 15 minutes. Auto-cancelling.');
        this.cancel();
        break;
      }
      await sleep(500);
    }
    if (!this.isCancelled) onResume?.();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
