import { describe, expect, it, vi } from 'vitest';
import type { LocalWorkflow } from '../../shared/types.js';
import type { JsonStore } from './automation-history-repository.js';
import { createWorkflowRepository } from './workflow-repository.js';

function memoryStore(initial: Record<string, unknown> = {}): JsonStore & { files: Record<string, unknown> } {
  const files = { ...initial };
  return {
    files,
    read<T>(filePath: string, fallback: T): T {
      return (filePath in files ? files[filePath] : fallback) as T;
    },
    write(filePath: string, value: unknown): void {
      files[filePath] = value;
    },
  };
}

function workflow(id = 'workflow-1'): LocalWorkflow {
  return {
    id,
    name: 'Example workflow',
    steps: [{ id: 'step-1', type: 'click', selector: '#old', onFailure: 'self_heal' }],
    createdAt: 1,
    updatedAt: 1,
    source: 'manual',
  };
}

describe('workflow repository', () => {
  it('quarantines invalid records while retaining valid workflows', () => {
    const store = memoryStore({ workflows: { workflows: [workflow(), { id: 'broken' }] } });
    const warn = vi.fn();
    const repository = createWorkflowRepository({ filePath: 'workflows', legacyFilePath: 'legacy', store, warn });

    expect(repository.list()).toHaveLength(1);
    expect(store.files.legacy).toEqual({ workflows: [{ id: 'broken' }] });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('upserts, repairs selectors, and deletes without changing the file shape', () => {
    const store = memoryStore();
    let now = 10;
    const repository = createWorkflowRepository({ filePath: 'workflows', legacyFilePath: 'legacy', store, now: () => now });

    repository.save(workflow());
    repository.updateStepSelector('workflow-1', 'step-1', '#new');
    expect(repository.list()[0]?.steps[0]).toMatchObject({ selector: '#new' });
    expect(repository.list()[0]?.updatedAt).toBe(10);

    now = 20;
    repository.save({ ...workflow(), name: 'Updated' });
    expect(repository.list()).toHaveLength(1);
    expect(repository.list()[0]?.name).toBe('Updated');

    repository.delete('workflow-1');
    expect(repository.list()).toEqual([]);
    expect(store.files.workflows).toEqual({ workflows: [] });
  });
});
