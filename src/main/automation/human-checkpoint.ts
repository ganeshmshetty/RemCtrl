/**
 * @file human-checkpoint.ts
 * @description Provides a bridge to pause automation execution and request manual human takeover or input (e.g. for CAPTCHAs, 2FA, or ambiguous scenarios).
 * Key Exported APIs: `ask` method to suspend executions, `submitCheckpointResponse` to resolve suspended tasks, `globalCheckpointCallbacks` map, and `CheckpointOption` interface.
 * Internal Mechanics: Suspends the execution flow using a Promise and registers callback handlers. Broadcasts an IPC message `browser:agentCheckpoint` to Electron renderer windows and sets up timeouts and abort listeners.
 * Relations: Invoked from within the automation loop when human verification is required, and resolved by the IPC handler `browser:submitCheckpoint` in `agent.ipc.ts`.
 */

import type { AgentCheckpointPayload, CheckpointResponse } from '../../shared/types.js';
import { broadcastToRenderers } from '../ipc/renderer-events.js';

// ─── Pending callbacks ────────────────────────────────────────────────────────

/** Keyed by checkpointId. Populated in ask(), consumed in submitCheckpointResponse(). */
export const globalCheckpointCallbacks = new Map<
  string,
  (response: CheckpointResponse) => void
>();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckpointOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pause execution and ask the user to choose an option.
 *
 * Emits `browser:agentCheckpoint` to all renderer windows, then suspends
 * until the user submits a response or the optional timeout fires.
 *
 * @returns The selectedOptionId chosen by the user.
 */
export async function ask(
  taskId: string,
  step: number,
  question: string,
  options: CheckpointOption[],
  context: AgentCheckpointPayload['context'],
  timeoutMs = 10 * 60 * 1000,
  abortSignal?: AbortSignal,
): Promise<string> {
  const checkpointId = generateCheckpointId();

  if (abortSignal?.aborted) {
    throw new Error(`Checkpoint ${checkpointId} cancelled`);
  }

  const payload: AgentCheckpointPayload = {
    checkpointId,
    taskId,
    step,
    question,
    options,
    context,
  };

  broadcastToRenderers('browser:agentCheckpoint', payload);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      globalCheckpointCallbacks.delete(checkpointId);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(abortSignal?.reason || new Error(`Checkpoint ${checkpointId} cancelled`));
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Checkpoint ${checkpointId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    globalCheckpointCallbacks.set(checkpointId, (response: CheckpointResponse) => {
      if (response.selectedOptionId === '__CANCELLED__') {
        cleanup();
        reject(new Error(`Checkpoint ${checkpointId} cancelled`));
        return;
      }

      const validIds = options.map((o) => o.id);
      if (!validIds.includes(response.selectedOptionId)) {
        cleanup();
        reject(
          new Error(
            `Invalid option ID "${response.selectedOptionId}". Valid: ${validIds.join(', ')}`,
          ),
        );
        return;
      }

      cleanup();
      resolve(response.selectedOptionId);
    });
  });
}

/**
 * Called by the IPC handler when the user submits a checkpoint response.
 * Routes to the correct pending Promise via checkpointId.
 */
export async function submitCheckpointResponse(
  checkpointId: string,
  response: CheckpointResponse,
): Promise<void> {
  const callback = globalCheckpointCallbacks.get(checkpointId);
  if (!callback) {
    throw new Error(`No pending checkpoint found for ID: ${checkpointId}`);
  }
  callback(response);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateCheckpointId(): string {
  return `checkpoint_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
