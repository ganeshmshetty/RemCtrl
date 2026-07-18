/**
 * Small async primitives shared by agent and workflow execution.
 * They keep waits and retry backoff interruptible without coupling browser
 * actions to the TaskSession implementation.
 */

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === 'string' ? reason : 'Automation was cancelled.');
}

export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    throwIfAborted(signal);
  } catch (error) {
    return Promise.reject(error);
  }
  if (ms <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
