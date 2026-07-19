import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocalWhisperSetupState, SpeechInputMode } from '../../shared/types';

export type SpeechStatus = 'idle' | 'unavailable';

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

/**
 * Local-only speech control seam. Browser Web Speech and cloud recognition are
 * intentionally absent. A future packaged native runner must replace the
 * unavailable adapter before this hook can begin microphone capture.
 */
export function useSpeechToText({
  enabled,
  mode: _mode,
  setup,
  onTranscript: _onTranscript,
}: {
  enabled: boolean;
  mode: SpeechInputMode;
  setup: LocalWhisperSetupState;
  onTranscript: (text: string, isFinal: boolean) => void;
}) {
  const gate = useMemo(() => getLocalSpeechGate(enabled, setup), [enabled, setup]);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(gate.message);

  void _mode;
  void _onTranscript;

  useEffect(() => {
    if (!gate.ready) {
      setStatus('unavailable');
      setError(gate.message);
      return;
    }
    setStatus('idle');
    setError(null);
  }, [gate]);

  const start = useCallback(() => {
    if (!gate.ready) {
      setStatus('unavailable');
      setError(gate.message);
      return;
    }
    // This branch is unreachable in Task 8: the typed main-process adapter
    // reports native-runner-not-packaged. Do not substitute browser recognition.
    setStatus('unavailable');
    setError('Local Whisper transcription is unavailable because this build does not include a native whisper.cpp runner.');
  }, [gate]);

  const stop = useCallback(() => {
    setStatus(gate.ready ? 'idle' : 'unavailable');
  }, [gate.ready]);

  return {
    start,
    stop,
    status,
    error,
    isSupported: gate.ready,
    isListening: false,
  };
}
