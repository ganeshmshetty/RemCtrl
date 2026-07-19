import type { WhisperRuntimeAvailability, WhisperRuntimeReason } from '../../shared/types.js';

export type { WhisperRuntimeAvailability, WhisperRuntimeReason } from '../../shared/types.js';

export const WHISPER_SAMPLE_RATE = 16_000;
export const MAX_LOCAL_WHISPER_AUDIO_SAMPLES = WHISPER_SAMPLE_RATE * 60;

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

const availability: WhisperRuntimeAvailability = {
  available: true,
  reason: 'onnx-local' satisfies WhisperRuntimeReason,
  message: 'Local ONNX Whisper transcription is ready on this device.',
};

export interface LocalWhisperRuntime {
  getAvailability(): WhisperRuntimeAvailability;
  transcribe(audio: Float32Array): Promise<string>;
}

const validateAudio = (audio: Float32Array): void => {
  if (!(audio instanceof Float32Array)) {
    throw new TypeError('Local Whisper expects a Float32Array of mono 16 kHz samples.');
  }
  if (audio.length === 0) {
    throw new TypeError('Local Whisper expects a non-empty Float32Array of mono 16 kHz samples.');
  }
  if (audio.length > MAX_LOCAL_WHISPER_AUDIO_SAMPLES) {
    throw new RangeError('Local Whisper audio cannot be longer than 60 seconds.');
  }
  for (const sample of audio) {
    if (!Number.isFinite(sample)) throw new TypeError('Local Whisper audio samples must be finite.');
  }
};

const defaultPipelineFactory: LocalWhisperPipelineFactory = async (task, modelDirectory, options) => {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.localModelPath = modelDirectory;
  return pipeline(task, modelDirectory, options) as unknown as LocalWhisperPipeline;
};

export interface LocalWhisperRuntimeOptions {
  /** Internal verified directory; never exposed through renderer IPC. */
  modelDirectory: string;
  pipelineFactory?: LocalWhisperPipelineFactory;
}

export function createLocalWhisperRuntime({ modelDirectory, pipelineFactory = defaultPipelineFactory }: LocalWhisperRuntimeOptions): LocalWhisperRuntime {
  let pipelinePromise: Promise<LocalWhisperPipeline> | null = null;

  const getPipeline = () => {
    if (!pipelinePromise) {
      pipelinePromise = pipelineFactory('automatic-speech-recognition', modelDirectory, {
        local_files_only: true,
        dtype: 'q8',
      }).catch((error: unknown) => {
        pipelinePromise = null;
        throw error;
      });
    }
    return pipelinePromise;
  };

  return {
    getAvailability: () => availability,
    transcribe: async (audio) => {
      validateAudio(audio);
      const pipeline = await getPipeline();
      const result = await pipeline(audio, { return_timestamps: false });
      return result.text?.trim() ?? '';
    },
  };
}
