import { describe, expect, it, vi } from 'vitest';
import { registerSpeechIpc } from './speech.ipc.js';
import type { WhisperModelManager, WhisperModelState } from '../speech/whisper-model-manager.js';

describe('local Whisper IPC', () => {
  it('registers setup channels and the local transcription boundary', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
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
      getAvailability: () => ({ available: true, reason: 'onnx-local' as const, message: 'runner ready' }),
      transcribe: vi.fn(),
    };

    registerSpeechIpc({
      ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
      manager,
      runtime,
    });

    expect([...handlers.keys()]).toEqual([
      'speech:getSetupState',
      'speech:downloadModel',
      'speech:cancelDownload',
      'speech:retryDownload',
      'speech:transcribe',
    ]);
    expect(await handlers.get('speech:getSetupState')!()).toMatchObject({
      model: { status: 'not_installed' },
      runtime: { available: true, reason: 'onnx-local' },
    });
    await handlers.get('speech:downloadModel')!();
    await handlers.get('speech:cancelDownload')!();
    await handlers.get('speech:retryDownload')!();
    expect(manager.download).toHaveBeenCalledOnce();
    expect(manager.cancel).toHaveBeenCalledOnce();
    expect(manager.retry).toHaveBeenCalledOnce();

    const audio = new Float32Array([0, 0.25, -0.25]);
    vi.mocked(runtime.transcribe).mockResolvedValue('local transcript');
    vi.mocked(manager.getState).mockResolvedValue(installed);
    await expect(handlers.get('speech:transcribe')!({}, audio)).resolves.toBe('local transcript');
    expect(runtime.transcribe).toHaveBeenCalledWith(audio);
  });

  it('rejects injected setup payloads and invalid transcription payloads', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const modelState: WhisperModelState = { status: 'not_installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 0, progress: null, verified: false };
    const manager: WhisperModelManager = {
      getState: vi.fn(async () => modelState),
      download: vi.fn(async () => modelState),
      cancel: vi.fn(),
      retry: vi.fn(async () => modelState),
      getModelPath: () => '/not-exposed',
    };
    const runtime = {
      getAvailability: () => ({ available: true, reason: 'onnx-local' as const, message: 'runner ready' }),
      transcribe: vi.fn(),
    };

    registerSpeechIpc({
      ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
      manager,
      runtime,
    });

    await expect(handlers.get('speech:getSetupState')!({}, '/tmp/injected-model.bin')).rejects.toThrow();
    await expect(handlers.get('speech:downloadModel')!({}, { url: 'https://attacker.invalid/model.bin' })).rejects.toThrow();
    await expect(handlers.get('speech:retryDownload')!({}, new Uint8Array([1, 2, 3]))).rejects.toThrow();
    await expect(handlers.get('speech:cancelDownload')!({}, { audio: new Uint8Array([1, 2, 3]) })).rejects.toThrow();
    await expect(handlers.get('speech:transcribe')!({}, new Uint8Array([1, 2, 3]))).rejects.toThrow(/Float32Array/i);

    expect(manager.getState).not.toHaveBeenCalled();
    expect(manager.download).not.toHaveBeenCalled();
    expect(manager.retry).not.toHaveBeenCalled();
    expect(manager.cancel).not.toHaveBeenCalled();
    expect(runtime.transcribe).not.toHaveBeenCalled();
  });

  it('does not transcribe until the verified model is installed and runtime is available', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const notInstalled: WhisperModelState = { status: 'not_installed', fileName: 'whisper-tiny.en', sizeBytes: 1, bytesDownloaded: 0, progress: null, verified: false };
    const manager: WhisperModelManager = {
      getState: vi.fn(async () => notInstalled),
      download: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      getModelPath: () => '/not-exposed',
    };
    const runtime = {
      getAvailability: () => ({ available: true, reason: 'onnx-local' as const, message: 'ready' }),
      transcribe: vi.fn(),
    };

    registerSpeechIpc({
      ipc: { handle: (channel, handler) => handlers.set(channel, handler) },
      manager,
      runtime,
    });

    await expect(handlers.get('speech:transcribe')!({}, new Float32Array([0.1]))).rejects.toThrow(/model/i);
    expect(runtime.transcribe).not.toHaveBeenCalled();
  });
});
