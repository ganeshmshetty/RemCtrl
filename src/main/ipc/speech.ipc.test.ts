import { describe, expect, it, vi } from 'vitest';
import { registerSpeechIpc } from './speech.ipc.js';
import type { WhisperModelManager, WhisperModelState } from '../speech/whisper-model-manager.js';

describe('local Whisper setup IPC', () => {
  it('registers setup-only channels and never accepts a renderer supplied model URL or audio payload', async () => {
    const handlers = new Map<string, () => Promise<unknown>>();
    const notInstalled: WhisperModelState = { status: 'not_installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 0, progress: null, verified: false };
    const installed: WhisperModelState = { status: 'installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 1, progress: 1, verified: true };
    const manager: WhisperModelManager = {
      getState: vi.fn(async () => notInstalled),
      download: vi.fn(async () => installed),
      cancel: vi.fn(),
      retry: vi.fn(async () => installed),
      getModelPath: () => '/not-exposed',
    };
    const runtime = {
      getAvailability: () => ({ available: false, reason: 'native-runner-not-packaged' as const, message: 'runner missing' }),
      transcribe: vi.fn(),
    };

    registerSpeechIpc({
      ipc: { handle: (channel, handler) => handlers.set(channel, handler as () => Promise<unknown>) },
      manager,
      runtime,
    });

    expect([...handlers.keys()]).toEqual([
      'speech:getSetupState',
      'speech:downloadModel',
      'speech:cancelDownload',
      'speech:retryDownload',
    ]);
    expect(await handlers.get('speech:getSetupState')!()).toMatchObject({
      model: { status: 'not_installed' },
      runtime: { available: false, reason: 'native-runner-not-packaged' },
    });
    await handlers.get('speech:downloadModel')!();
    await handlers.get('speech:cancelDownload')!();
    await handlers.get('speech:retryDownload')!();
    expect(manager.download).toHaveBeenCalledOnce();
    expect(manager.cancel).toHaveBeenCalledOnce();
    expect(manager.retry).toHaveBeenCalledOnce();
  });
});
