import { describe, expect, it } from 'vitest';
import { createLocalWhisperRuntime } from './whisper-runtime.js';

describe('local Whisper runtime adapter', () => {
  it('reports the explicit packaging limitation and rejects transcription', async () => {
    const runtime = createLocalWhisperRuntime();

    expect(runtime.getAvailability()).toEqual({
      available: false,
      reason: 'native-runner-not-packaged',
      message: 'Local Whisper transcription is unavailable because this build does not include a native whisper.cpp runner.',
    });
    await expect(runtime.transcribe(new Uint8Array())).rejects.toThrow(/does not include a native whisper\.cpp runner/i);
  });
});
