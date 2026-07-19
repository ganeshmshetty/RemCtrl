export type WhisperRuntimeReason = 'native-runner-not-packaged';

export interface WhisperRuntimeAvailability {
  available: boolean;
  reason: WhisperRuntimeReason;
  message: string;
}

export interface LocalWhisperRuntime {
  getAvailability(): WhisperRuntimeAvailability;
  transcribe(audio: Uint8Array): Promise<string>;
}

const unavailable: WhisperRuntimeAvailability = {
  available: false,
  reason: 'native-runner-not-packaged',
  message: 'Local Whisper transcription is unavailable because this build does not include a native whisper.cpp runner.',
};

export function createLocalWhisperRuntime(): LocalWhisperRuntime {
  return {
    getAvailability: () => unavailable,
    transcribe: async (_audio) => {
      throw new Error(unavailable.message);
    },
  };
}
