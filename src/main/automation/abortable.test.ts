import { describe, expect, it } from 'vitest';
import { waitFor } from './abortable.js';

describe('abortable waits', () => {
  it('rejects promptly when the automation signal is aborted', async () => {
    const controller = new AbortController();
    const pending = waitFor(10_000, controller.signal);
    controller.abort(new Error('stop now'));

    await expect(pending).rejects.toThrow('stop now');
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already stopped'));

    await expect(waitFor(1, controller.signal)).rejects.toThrow('already stopped');
  });
});
