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

export type SpeechStatus = 'idle' | 'listening' | 'reconnecting' | 'unsupported' | 'permission' | 'error';

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
  const keepListeningRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const clearRestart = useCallback(() => {
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    keepListeningRef.current = false;
    clearRestart();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setStatus('idle');
  }, [clearRestart]);

  const start = useCallback(() => {
    if (!enabled) return;
    const Constructor = getRecognitionConstructor();
    if (!Constructor) {
      setStatus('unsupported');
      setError('Speech input is not supported in this browser.');
      return;
    }
    if (recognitionRef.current || restartTimerRef.current !== null) return;

    const shouldKeepListening = mode === 'hands_free';
    keepListeningRef.current = shouldKeepListening;
    setError(null);

    const beginRecognition = () => {
      if (recognitionRef.current) return;
      const recognition = new Constructor();
      recognition.continuous = shouldKeepListening;
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
        if (event.error === 'no-speech' && keepListeningRef.current) {
          setStatus('reconnecting');
          return;
        }
        keepListeningRef.current = false;
        setError(messageForSpeechError(event.error));
        setStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'permission' : 'error');
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        if (keepListeningRef.current && restartTimerRef.current === null) {
          setStatus('reconnecting');
          restartTimerRef.current = window.setTimeout(() => {
            restartTimerRef.current = null;
            beginRecognition();
          }, 350);
          return;
        }
        setStatus((current) => current === 'error' || current === 'permission' || current === 'unsupported' ? current : 'idle');
      };
      recognitionRef.current = recognition;
      setStatus('listening');
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        keepListeningRef.current = false;
        setStatus('error');
        setError('Microphone could not start. Check microphone permissions and try again.');
      }
    };

    beginRecognition();
  }, [enabled, mode]);

  useEffect(() => () => {
    keepListeningRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled && (recognitionRef.current || restartTimerRef.current !== null)) stop();
  }, [enabled, stop]);

  return {
    start,
    stop,
    status,
    error,
    isSupported: Boolean(getRecognitionConstructor()),
    isListening: status === 'listening' || status === 'reconnecting',
  };
}
