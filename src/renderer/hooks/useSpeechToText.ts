import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalWhisperSetupState, SpeechInputMode } from '../../shared/types';

const WHISPER_SAMPLE_RATE = 16_000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4_096;

export type SpeechStatus = 'idle' | 'listening' | 'unavailable';

export interface LocalSpeechGate {
  ready: boolean;
  message: string | null;
}

export function getLocalSpeechGate(
  microphoneAudioEnabled: boolean,
  setup: LocalWhisperSetupState,
): LocalSpeechGate {
  if (setup.model.status !== 'installed' || !setup.model.verified) {
    return { ready: false, message: 'Download and verify the local Whisper model in Settings.' };
  }
  if (!microphoneAudioEnabled) {
    return { ready: false, message: 'Enable microphone audio in Settings before dictating.' };
  }
  if (!setup.runtime.available) {
    return { ready: false, message: setup.runtime.message };
  }
  return { ready: true, message: null };
}

/** Resample mono PCM with linear interpolation for Whisper's 16 kHz input. */
export function resampleAudio(samples: Float32Array, inputSampleRate: number, targetSampleRate = WHISPER_SAMPLE_RATE): Float32Array {
  if (samples.length === 0) return new Float32Array();
  if (inputSampleRate === targetSampleRate) return samples.slice();
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0 || !Number.isFinite(targetSampleRate) || targetSampleRate <= 0) {
    throw new RangeError('Audio sample rates must be positive finite numbers.');
  }

  const ratio = inputSampleRate / targetSampleRate;
  const output = new Float32Array(Math.max(1, Math.round(samples.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const weight = position - leftIndex;
    output[index] = samples[leftIndex] * (1 - weight) + samples[rightIndex] * weight;
  }
  return output;
}

function mergeAudioChunks(chunks: readonly Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

interface SpeechCapture {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
}

/**
 * Local-only speech capture. Microphone PCM is sent only to the main-process
 * local ONNX runtime through the narrow preload speech API.
 */
export function useSpeechToText({
  enabled,
  mode: _mode,
  setup,
  onTranscript,
}: {
  enabled: boolean;
  mode: SpeechInputMode;
  setup: LocalWhisperSetupState;
  onTranscript: (text: string, isFinal: boolean) => void;
}) {
  const gate = useMemo(() => getLocalSpeechGate(enabled, setup), [enabled, setup]);
  const captureRef = useRef<SpeechCapture | null>(null);
  const startSequenceRef = useRef(0);
  const transcribingRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  void _mode;

  const start = useCallback(async () => {
    if (!gate.ready || captureRef.current || transcribingRef.current) return;
    const sequence = ++startSequenceRef.current;
    setRuntimeError(null);

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (sequence !== startSequenceRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      context = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      captureRef.current = { stream, context, source, processor, sink, chunks };
      setIsListening(true);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) await context.close().catch(() => undefined);
      setRuntimeError(error instanceof Error ? `Microphone capture failed: ${error.message}` : 'Microphone capture failed.');
    }
  }, [gate.ready]);

  const stop = useCallback(() => {
    startSequenceRef.current += 1;
    const capture = captureRef.current;
    captureRef.current = null;
    setIsListening(false);
    if (!capture) return;

    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.sink.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    const sampleRate = capture.context.sampleRate;
    void capture.context.close();

    const audio = resampleAudio(mergeAudioChunks(capture.chunks), sampleRate);
    if (audio.length === 0) {
      setRuntimeError('No microphone audio was captured.');
      return;
    }

    transcribingRef.current = true;
    setIsTranscribing(true);
    void window.RemoteCtrlAPI.speech.transcribe(audio).then((text) => {
      if (text.trim()) onTranscript(text.trim(), true);
    }).catch((error: unknown) => {
      setRuntimeError(error instanceof Error ? error.message : 'Local Whisper transcription failed.');
    }).finally(() => {
      transcribingRef.current = false;
      setIsTranscribing(false);
    });
  }, [onTranscript]);

  useEffect(() => () => {
    startSequenceRef.current += 1;
    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) return;
    capture.processor.onaudioprocess = null;
    capture.source.disconnect();
    capture.processor.disconnect();
    capture.sink.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close();
  }, []);

  const error = gate.message ?? runtimeError;
  const status: SpeechStatus = error ? 'unavailable' : isListening ? 'listening' : 'idle';

  return {
    start,
    stop,
    status,
    error,
    isSupported: gate.ready && !isTranscribing,
    isListening,
  };
}
