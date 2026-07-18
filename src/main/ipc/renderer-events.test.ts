import { describe, expect, it, vi } from 'vitest';
import { broadcastToWindows, sendToRenderer, type RendererWindow } from './renderer-events.js';

function fakeWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  } satisfies RendererWindow;
}

describe('renderer event delivery', () => {
  it('broadcasts to live windows and skips destroyed ones', () => {
    const live = fakeWindow();
    const destroyed = fakeWindow(true);

    broadcastToWindows([live, destroyed], 'agent:status', { state: 'running' });

    expect(live.webContents.send).toHaveBeenCalledWith('agent:status', { state: 'running' });
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it('treats a missing or destroyed target as a no-op', () => {
    const destroyed = fakeWindow(true);

    sendToRenderer(undefined, 'app:error', 'closed');
    sendToRenderer(destroyed, 'app:error', 'closed');

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });
});
