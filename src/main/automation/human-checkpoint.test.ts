import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import { ask, globalCheckpointCallbacks } from './human-checkpoint.js';

describe('human checkpoints', () => {
  it('removes a pending checkpoint when its task is aborted', async () => {
    const controller = new AbortController();
    const pending = ask(
      'task-1',
      1,
      'Choose an option',
      [{ id: 'continue', label: 'Continue' }],
      { currentPage: 'https://example.com', taskProgress: 'Waiting' },
      5_000,
      controller.signal,
    );

    expect(globalCheckpointCallbacks.size).toBe(1);
    controller.abort(new Error('run cancelled'));

    await expect(pending).rejects.toThrow('run cancelled');
    expect(globalCheckpointCallbacks.size).toBe(0);
  });

  it('handles an abort racing listener registration without leaking the callback', async () => {
    const controller = new AbortController();
    const originalAddEventListener = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation((type, listener, options) => {
      const result = originalAddEventListener(type, listener, options);
      controller.abort(new Error('aborted during registration'));
      return result;
    });

    const pending = ask(
      'task-2',
      1,
      'Choose an option',
      [{ id: 'continue', label: 'Continue' }],
      { currentPage: 'https://example.com', taskProgress: 'Waiting' },
      5_000,
      controller.signal,
    );

    await expect(pending).rejects.toThrow('aborted during registration');
    expect(globalCheckpointCallbacks.size).toBe(0);
  });
});
