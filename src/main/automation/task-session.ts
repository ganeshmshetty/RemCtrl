/**
 * TaskSession — Authoritative lifecycle state for one agent or workflow run.
 *
 * Replaces the three module-level globals (activeCommandId/activeRunId,
 * cancelRequested, isPaused) that were duplicated across agent-executor,
 * agent-runner, and workflow-executor.
 *
 * State machine:
 *   idle → running → paused ⇄ running → cancelled
 *                          └────────────────────→ cancelled
 */

export type TaskStatus = 'idle' | 'running' | 'paused' | 'cancelled';

export class TaskSession {
  private _status: TaskStatus = 'idle';

  // ─── Reads ────────────────────────────────────────────────────────────────

  get isCancelled(): boolean { return this._status === 'cancelled'; }
  get isPaused():    boolean { return this._status === 'paused'; }
  get isActive():    boolean { return this._status === 'running' || this._status === 'paused'; }
  get status():      TaskStatus { return this._status; }

  // ─── Transitions ──────────────────────────────────────────────────────────

  start():  void { this._status = 'running'; }
  cancel(): void { this._status = 'cancelled'; }

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
    while (this._status === 'paused') {
      await sleep(500);
    }
    if (!this.isCancelled) onResume?.();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
