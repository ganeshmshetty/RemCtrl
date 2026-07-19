import { describe, expect, it } from 'vitest';
import { getLocalSpeechGate, resampleAudio } from './useSpeechToText';
import type { LocalWhisperSetupState } from '../../shared/types';

const unavailableRuntime = {
  available: false,
  reason: 'onnx-local' as const,
  message: 'Local ONNX Whisper transcription is ready on this device.',
};

function setup(overrides: Partial<LocalWhisperSetupState> = {}): LocalWhisperSetupState {
  return {
    model: { status: 'not_installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 0, progress: null, verified: false },
    runtime: unavailableRuntime,
    ...overrides,
  };
}

describe('local speech readiness gate', () => {
  it('requires a verified model and explicit microphone enablement before a runtime can start', () => {
    expect(getLocalSpeechGate(false, setup())).toMatchObject({ ready: false, message: 'Download and verify the local Whisper model in Settings.' });
    expect(getLocalSpeechGate(true, setup({ model: { status: 'installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 1, progress: 1, verified: true } }))).toMatchObject({
      ready: false,
      message: unavailableRuntime.message,
    });
    expect(getLocalSpeechGate(false, setup({
      model: { status: 'installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 1, progress: 1, verified: true },
      runtime: { available: true, reason: 'onnx-local', message: '' },
    }))).toMatchObject({ ready: false, message: 'Enable microphone audio in Settings before dictating.' });
  });

  it('permits controls only when every local prerequisite is available', () => {
    expect(getLocalSpeechGate(true, setup({
      model: { status: 'installed', fileName: 'ggml-tiny.en.bin', sizeBytes: 1, bytesDownloaded: 1, progress: 1, verified: true },
      runtime: { available: true, reason: 'onnx-local', message: '' },
    }))).toEqual({ ready: true, message: null });
  });

  it('resamples microphone PCM to the 16 kHz Whisper input rate', () => {
    const result = resampleAudio(new Float32Array([0, 1, 0, -1]), 8_000, 16_000);

    expect(result).toHaveLength(8);
    expect(Array.from(result)).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
  });
});
