/**
 * Atomic, bounded metadata for runs that may outlive a renderer window.
 * Action details remain in the session journal; this file intentionally stores
 * only recovery-safe progress and never page content, credentials, or tool args.
 */

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AutomationRunCheckpoint } from '../../shared/types.js';

const CHECKPOINT_DIR = path.join(app.getPath('userData'), 'automation-checkpoints');
const writes = new Map<string, Promise<void>>();

function checkpointPath(id: string): string {
  return path.join(CHECKPOINT_DIR, `${id}.json`);
}

function enqueue(id: string, operation: () => Promise<void>): Promise<void> {
  const previous = writes.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writes.set(id, next);
  void next.finally(() => {
    if (writes.get(id) === next) writes.delete(id);
  }).catch(() => {});
  return next;
}

export function saveRunCheckpoint(checkpoint: AutomationRunCheckpoint): Promise<void> {
  return enqueue(checkpoint.id, async () => {
    await fs.promises.mkdir(CHECKPOINT_DIR, { recursive: true });
    const target = checkpointPath(checkpoint.id);
    const temp = `${target}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(checkpoint, null, 2), 'utf8');
    await fs.promises.rename(temp, target);
  });
}

export function removeRunCheckpoint(id: string): Promise<void> {
  return enqueue(id, async () => {
    await fs.promises.rm(checkpointPath(id), { force: true });
  });
}

export function listRunCheckpoints(): AutomationRunCheckpoint[] {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) return [];
    return fs.readdirSync(CHECKPOINT_DIR)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(CHECKPOINT_DIR, name), 'utf8')) as AutomationRunCheckpoint;
          if (!parsed.id || !parsed.commandId || !parsed.kind || !parsed.title) return [];
          return [{ ...parsed, status: parsed.status === 'running' ? 'interrupted' : parsed.status }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}
