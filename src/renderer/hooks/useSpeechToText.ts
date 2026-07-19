import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechInputMode } from '../../shared/types';

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export type SpeechStatus = 'idle' | 'listening' | 'unsupported' | 'permission' | 'error';

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function messageForSpeechError(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone access is blocked. Allow microphone access for RemoteCtrl in system or site settings.';
  if (code === 'audio-capture') return 'No microphone is available. Connect a microphone and try again.';
  if (code === 'network') return 'Speech recognition could not reach its language service.';
  if (code === 'no-speech') return 'No speech was detected.';
  return 'Speech recognition stopped unexpectedly. Try again.';
}

export function useSpeechToText({
  enabled,
  mode,
  onTranscript,
}: {
  enabled: boolean;
  mode: SpeechInputMode;
  onTranscript: (text: string, isFinal: boolean) => void;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setStatus((current) => current === 'error' || current === 'unsupported' ? current : 'idle');
  }, []);

  const start = useCallback(() => {
    if (!enabled) return;
    const Constructor = getRecognitionConstructor();
    if (!Constructor) {
      setStatus('unsupported');
      setError('Speech input is not supported in this browser.');
      return;
    }
    if (recognitionRef.current) return;

    setError(null);
    const recognition = new Constructor();
    recognition.continuous = mode === 'hands_free';
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        onTranscriptRef.current(result[0].transcript, result.isFinal);
      }
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      const nextError = messageForSpeechError(event.error);
      setError(nextError);
      setStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'permission' : 'error');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((current) => current === 'error' || current === 'permission' || current === 'unsupported' ? current : 'idle');
    };
    recognitionRef.current = recognition;
    setStatus('listening');
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setStatus('error');
      setError('Microphone could not start. Check microphone permissions and try again.');
    }
  }, [enabled, mode]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled && recognitionRef.current) stop();
  }, [enabled, stop]);

  return {
    start,
    stop,
    status,
    error,
    isSupported: Boolean(getRecognitionConstructor()),
    isListening: status === 'listening',
  };
}
