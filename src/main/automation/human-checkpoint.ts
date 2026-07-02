/**
 * Human Checkpoint — Live path for pausing an agent at a decision point.
 *
 * The live mechanism is a simple Map of pending Promise callbacks.
 * When the agent calls ask(), it emits a UI event and then awaits a
 * Promise that resolves when the user picks an option via IPC
 * (browser:submitCheckpoint → submitCheckpointResponse).
 *
 * The HumanCheckpointManager class and UncertaintyDetector that previously
 * lived here were never instantiated in any running path and have been removed.
 * The file-backed persistence logic they contained can be reintroduced
 * if resumable tasks become a roadmap item.
 */

import { BrowserWindow } from 'electron';
import type { AgentCheckpointPayload, CheckpointResponse } from '../../shared/types.js';

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
): Promise<string> {
  const checkpointId = generateCheckpointId();

  const payload: AgentCheckpointPayload = {
    checkpointId,
    taskId,
    step,
    question,
    options,
    context,
  };

  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('browser:agentCheckpoint', payload);
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      globalCheckpointCallbacks.delete(checkpointId);
      reject(new Error(`Checkpoint ${checkpointId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    globalCheckpointCallbacks.set(checkpointId, (response: CheckpointResponse) => {
      if (response.selectedOptionId === '__CANCELLED__') {
        clearTimeout(timeout);
        globalCheckpointCallbacks.delete(checkpointId);
        reject(new Error(`Checkpoint ${checkpointId} cancelled`));
        return;
      }

      const validIds = options.map((o) => o.id);
      if (!validIds.includes(response.selectedOptionId)) {
        throw new Error(
          `Invalid option ID "${response.selectedOptionId}". Valid: ${validIds.join(', ')}`,
        );
      }

      clearTimeout(timeout);
      globalCheckpointCallbacks.delete(checkpointId);
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
