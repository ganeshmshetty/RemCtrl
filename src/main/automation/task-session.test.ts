import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/remotectrl-task-session-tests' },
}));

import { TaskSession } from './task-session.js';

describe('TaskSession', () => {
  it('keeps a paused run alive until an explicit resume', async () => {
    const session = new TaskSession({ commandId: 'pause-test' });
    session.start();
    session.pause();

    let resumed = false;
    const waiting = session.waitIfPaused(undefined, () => { resumed = true; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(session.isPaused).toBe(true);
    expect(resumed).toBe(false);

    session.resume();
    await waiting;
    expect(resumed).toBe(true);
    expect(session.isActive).toBe(true);
  });

  it('reports watchdog failures separately from user cancellation', () => {
    const session = new TaskSession({ commandId: 'failure-test' });
    session.start();
    const failure = new Error('stalled');
    session.fail(failure);

    expect(session.isFailed).toBe(true);
    expect(session.isCancelled).toBe(false);
    expect(session.failure).toBe(failure);
    expect(session.abortSignal.aborted).toBe(true);
  });
});
