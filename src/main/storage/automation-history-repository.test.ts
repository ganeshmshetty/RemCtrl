import { describe, expect, it } from 'vitest';
import type { AutomationRunHistoryItem } from '../../shared/types.js';
import { createAutomationHistoryRepository, type JsonStore } from './automation-history-repository.js';

function item(id: string, startTime: number, endTime?: number): AutomationRunHistoryItem {
  return {
    id,
    type: 'agent',
    title: `Run ${id}`,
    startTime,
    endTime,
    status: 'completed',
    logs: [],
    chatHistory: [],
  };
}

function memoryStore(initial: unknown = []): JsonStore & { value: unknown } {
  const store = {
    value: initial,
    read<T>(_filePath: string, fallback: T): T {
      return (store.value === undefined ? fallback : store.value) as T;
    },
    write(_filePath: string, value: unknown): void {
      store.value = value;
    },
  };
  return store;
}

describe('automation history repository', () => {
  it('filters invalid records, sorts newest first, and enforces retention', () => {
    const store = memoryStore([item('old', 1), { id: 'invalid' }, item('new', 3)]);
    const repository = createAutomationHistoryRepository({
      filePath: 'history.json',
      store,
      maxItems: 1,
    });

    expect(repository.list().map((run) => run.id)).toEqual(['new']);
  });

  it('updates by id and supports deletion and clearing', () => {
    const store = memoryStore();
    const repository = createAutomationHistoryRepository({ filePath: 'history.json', store });

    repository.save(item('first', 1));
    repository.save(item('second', 2));
    repository.save({ ...item('first', 4), title: 'Updated' });

    expect(repository.list().map((run) => run.id)).toEqual(['first', 'second']);
    expect(repository.list()[0]?.title).toBe('Updated');

    repository.delete('first');
    expect(repository.list().map((run) => run.id)).toEqual(['second']);
    repository.clear();
    expect(repository.list()).toEqual([]);
  });
});
