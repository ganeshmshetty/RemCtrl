import { describe, expect, it } from 'vitest';
import { env } from '@huggingface/transformers';
import {
  configureLocalWhisperEnvironment,
  createLocalWhisperWorker,
  type LocalWhisperPipeline,
} from './local-whisper.worker.js';

describe('local Whisper worker foundation', () => {
  it('configures Transformers.js and the WASM backend for local-only inference', () => {
    const previous = {
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
      localModelPath: env.localModelPath,
      useBrowserCache: env.useBrowserCache,
      useFSCache: env.useFSCache,
      wasmPaths: env.backends.onnx.wasm.wasmPaths,
    };

    configureLocalWhisperEnvironment('/verified/whisper-tiny.en', '/assets/onnxruntime/');

    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe('/verified/whisper-tiny.en');
    expect(env.useBrowserCache).toBe(false);
    expect(env.useFSCache).toBe(false);
    expect(env.backends.onnx.wasm.wasmPaths).toBe('/assets/onnxruntime/');

    env.allowRemoteModels = previous.allowRemoteModels;
    env.allowLocalModels = previous.allowLocalModels;
    env.localModelPath = previous.localModelPath;
    env.useBrowserCache = previous.useBrowserCache;
    env.useFSCache = previous.useFSCache;
    env.backends.onnx.wasm.wasmPaths = previous.wasmPaths;
  });

  it('passes only a Float32 mono 16 kHz buffer to the injected local pipeline and returns final text', async () => {
    let received: Float32Array | undefined;
    let pipelineOptions: unknown;
    const pipelineInstance = (async (audio: Float32Array, options?: { return_timestamps?: false }) => {
      received = audio;
      pipelineOptions = options;
      return { text: '  local transcript  ' };
    }) as LocalWhisperPipeline;
    const worker = createLocalWhisperWorker({
      modelDirectory: '/verified/whisper-tiny.en',
      pipelineFactory: async (task, modelDirectory, options) => {
        expect(task).toBe('automatic-speech-recognition');
        expect(modelDirectory).toBe('/verified/whisper-tiny.en');
        expect(options).toEqual({ local_files_only: true, dtype: 'q8' });
        return pipelineInstance;
      },
    });
    const audio = new Float32Array([0, 0.25, -0.25]);

    await expect(worker.transcribe(audio)).resolves.toBe('local transcript');
    expect(received).toBe(audio);
    expect(pipelineOptions).toEqual({ return_timestamps: false });
  });

  it('rejects invalid audio instead of sending it to the model', async () => {
    let called = false;
    const worker = createLocalWhisperWorker({
      modelDirectory: '/verified/whisper-tiny.en',
      pipelineFactory: async () => {
        called = true;
        return (async () => ({ text: 'unexpected' })) as LocalWhisperPipeline;
      },
    });

    await expect(worker.transcribe(new Float32Array())).rejects.toThrow(/non-empty/i);
    await expect(worker.transcribe(new Float32Array([Number.NaN]))).rejects.toThrow(/finite/i);
    expect(called).toBe(true);
  });
});
