import { describe, expect, it } from 'vitest';
import {
  beginSpeechComposition,
  canStartSpeech,
  applySpeechTranscript,
  markManualSpeechEdit,
  stopSpeechComposition,
  toggleSpeechComposition,
} from './miniWindowSpeech';

describe('Mini Window speech composition', () => {
  it('keeps a manual textarea edit when recognition reports a later interim or final result', () => {
    let composition = beginSpeechComposition('existing prompt');
    let instruction = 'existing prompt';

    ({ state: composition, instruction } = applySpeechTranscript(composition, instruction, 'first phrase', false));
    expect(instruction).toBe('existing prompt first phrase');

    composition = markManualSpeechEdit(composition);
    instruction = 'my manual edit';
    ({ state: composition, instruction } = applySpeechTranscript(composition, instruction, 'stale interim', false));
    expect(instruction).toBe('my manual edit');
    expect(applySpeechTranscript(composition, instruction, 'stale final', true).instruction).toBe('my manual edit');
  });

  it('starts and stops push-to-talk composition', () => {
    const started = beginSpeechComposition('');
    expect(started.active).toBe(true);
    expect(stopSpeechComposition(started).active).toBe(false);
  });

  it('supports hands-free toggle transitions through the same start/stop state', () => {
    const started = toggleSpeechComposition({ active: false, base: '' }, 'hands free');
    expect(started.active).toBe(true);
    expect(toggleSpeechComposition(started, 'ignored while listening').active).toBe(false);
  });

  it('does not allow disabled or unsupported speech controls to start', () => {
    expect(canStartSpeech({ enabled: false, isSupported: true, isRunning: false })).toBe(false);
    expect(canStartSpeech({ enabled: true, isSupported: false, isRunning: false })).toBe(false);
    expect(canStartSpeech({ enabled: true, isSupported: true, isRunning: true })).toBe(false);
    expect(canStartSpeech({ enabled: true, isSupported: true, isRunning: false, hasError: true })).toBe(false);
    expect(canStartSpeech({ enabled: true, isSupported: true, isRunning: false })).toBe(true);
  });
});
