import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getMicrophoneAudioEnabled: vi.fn(() => false),
  setMicrophoneAudioEnabled: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/remotectrl-settings-test', getVersion: () => 'test' },
  ipcMain: { handle: vi.fn() },
  safeStorage: {},
}));

vi.mock('../storage.js', async () => {
  const actual = await vi.importActual<typeof import('../storage.js')>('../storage.js');
  return {
    ...actual,
    getMicrophoneAudioEnabled: storageMocks.getMicrophoneAudioEnabled,
    setMicrophoneAudioEnabled: storageMocks.setMicrophoneAudioEnabled,
  };
});

import { registerSettingsIpc } from './settings.ipc.js';

describe('microphone settings IPC', () => {
  beforeEach(() => {
    storageMocks.getMicrophoneAudioEnabled.mockClear();
    storageMocks.setMicrophoneAudioEnabled.mockClear();
  });

  it('broadcasts the validated microphone state to every renderer context after persisting it', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const broadcast = vi.fn();

    registerSettingsIpc({
      ipc: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
      broadcast,
    } as any);

    await handlers.get('settings:setMicrophoneAudioEnabled')!({}, true);

    expect(storageMocks.setMicrophoneAudioEnabled).toHaveBeenCalledWith(true);
    expect(broadcast).toHaveBeenCalledWith('settings:microphoneAudioChanged', true);
  });

  it('rejects non-boolean microphone payloads without persisting or broadcasting them', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const broadcast = vi.fn();

    registerSettingsIpc({
      ipc: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
      broadcast,
    } as any);

    await expect(handlers.get('settings:setMicrophoneAudioEnabled')!({}, '/tmp/injected-audio')).rejects.toThrow();

    expect(storageMocks.setMicrophoneAudioEnabled).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
