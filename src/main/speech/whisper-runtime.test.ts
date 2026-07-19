import { describe, expect, it, vi } from 'vitest';
import { createLocalWhisperRuntime } from './whisper-runtime.js';

describe('local Whisper runtime adapter', () => {
  it('loads the verified ONNX model locally and returns its transcript', async () => {
    const pipeline = vi.fn(async () => ({ text: '  local transcript  ' }));
    const pipelineFactory = vi.fn(async (task, modelDirectory, options) => {
      expect(task).toBe('automatic-speech-recognition');
      expect(modelDirectory).toBe('/verified/whisper-tiny.en');
      expect(options).toEqual({ local_files_only: true, dtype: 'q8' });
      return pipeline;
    });
    const runtime = createLocalWhisperRuntime({
      modelDirectory: '/verified/whisper-tiny.en',
      pipelineFactory,
    });

    expect(runtime.getAvailability()).toEqual({
      available: true,
      reason: 'onnx-local',
      message: 'Local ONNX Whisper transcription is ready on this device.',
    });

    await expect(runtime.transcribe(new Float32Array([0, 0.25, -0.25]))).resolves.toBe('local transcript');
    expect(pipelineFactory).toHaveBeenCalledOnce();
    expect(pipeline).toHaveBeenCalledWith(new Float32Array([0, 0.25, -0.25]), { return_timestamps: false });
  });

  it('rejects invalid audio before invoking the local model', async () => {
    const pipeline = vi.fn(async () => ({ text: 'unexpected' }));
    const runtime = createLocalWhisperRuntime({
      modelDirectory: '/verified/whisper-tiny.en',
      pipelineFactory: async () => pipeline,
    });

    await expect(runtime.transcribe(new Uint8Array() as unknown as Float32Array)).rejects.toThrow(/Float32Array/i);
    await expect(runtime.transcribe(new Float32Array())).rejects.toThrow(/non-empty/i);
    await expect(runtime.transcribe(new Float32Array([Number.NaN]))).rejects.toThrow(/finite/i);
    expect(pipeline).not.toHaveBeenCalled();
  });
});
