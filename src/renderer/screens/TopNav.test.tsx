import { describe, expect, it, vi } from 'vitest';
import { confirmAndCloseSession } from './TopNav';

describe('TopNav session exit', () => {
  it('does not close the session when the user cancels confirmation', () => {
    const closeSession = vi.fn();

    const didClose = confirmAndCloseSession(() => false, closeSession);

    expect(didClose).toBe(false);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('runs the existing close/reset sequence after confirmation', () => {
    const closeSession = vi.fn();

    const didClose = confirmAndCloseSession(() => true, closeSession);

    expect(didClose).toBe(true);
    expect(closeSession).toHaveBeenCalledOnce();
  });
});
