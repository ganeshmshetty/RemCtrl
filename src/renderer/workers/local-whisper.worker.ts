import { env, pipeline } from '@huggingface/transformers';

export interface LocalWhisperPipelineOptions {
  local_files_only: true;
  dtype: 'q8';
}

export interface LocalWhisperPipeline {
  (audio: Float32Array, options?: { return_timestamps?: false }): Promise<{ text?: string }>;
}

export type LocalWhisperPipelineFactory = (
  task: 'automatic-speech-recognition',
  modelDirectory: string,
  options: LocalWhisperPipelineOptions,
) => Promise<LocalWhisperPipeline>;

export interface LocalWhisperWorkerOptions {
  /** This is an internal verified directory supplied by the model setup seam. */
  modelDirectory: string;
  wasmPath?: string;
  pipelineFactory?: LocalWhisperPipelineFactory;
}

export interface LocalWhisperWorker {
  transcribe(audio: Float32Array): Promise<string>;
}

export function configureLocalWhisperEnvironment(modelDirectory: string, wasmPath?: string): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelDirectory;
  env.useBrowserCache = false;
  env.useFSCache = false;
  if (wasmPath) env.backends.onnx.wasm.wasmPaths = wasmPath;
}

const defaultPipelineFactory: LocalWhisperPipelineFactory = async (task, modelDirectory, options) => (
  pipeline(task, modelDirectory, options) as unknown as Promise<LocalWhisperPipeline>
);

export function createLocalWhisperWorker({
  modelDirectory,
  wasmPath,
  pipelineFactory = defaultPipelineFactory,
}: LocalWhisperWorkerOptions): LocalWhisperWorker {
  configureLocalWhisperEnvironment(modelDirectory, wasmPath);
  const pipelinePromise = pipelineFactory('automatic-speech-recognition', modelDirectory, {
    local_files_only: true,
    dtype: 'q8',
  });

  return {
    async transcribe(audio) {
      if (!(audio instanceof Float32Array) || audio.length === 0) {
        throw new TypeError('Local Whisper expects a non-empty Float32Array of mono 16 kHz samples.');
      }
      for (const sample of audio) {
        if (!Number.isFinite(sample)) throw new TypeError('Local Whisper audio samples must be finite.');
      }
      const result = await (await pipelinePromise)(audio, { return_timestamps: false });
      return result.text?.trim() ?? '';
    },
  };
}
