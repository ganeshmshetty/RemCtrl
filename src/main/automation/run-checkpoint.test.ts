import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/remotectrl-run-checkpoint-tests' },
}));

import { listRunCheckpoints, removeRunCheckpoint, saveRunCheckpoint } from './run-checkpoint.js';

describe('run checkpoints', () => {
  it('writes atomically and treats a running process from disk as interrupted', async () => {
    const id = `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await saveRunCheckpoint({
      id,
      kind: 'agent',
      commandId: id,
      title: 'Find the latest invoice',
      startedAt: 1,
      updatedAt: 2,
      status: 'running',
      currentStep: 4,
      currentAction: 'Reading the invoice list',
    });

    expect(listRunCheckpoints().find((run) => run.id === id)).toMatchObject({
      id,
      status: 'interrupted',
      currentStep: 4,
    });

    await removeRunCheckpoint(id);
    expect(listRunCheckpoints().some((run) => run.id === id)).toBe(false);
    await fs.rm('/tmp/remotectrl-run-checkpoint-tests', { recursive: true, force: true });
  });
});
