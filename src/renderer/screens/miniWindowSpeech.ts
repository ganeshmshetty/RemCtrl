export interface SpeechComposition {
  active: boolean;
  base: string;
}

export function beginSpeechComposition(instruction: string): SpeechComposition {
  const trimmed = instruction.trim();
  return {
    active: true,
    base: trimmed ? `${trimmed} ` : '',
  };
}

export function stopSpeechComposition(composition: SpeechComposition): SpeechComposition {
  return { ...composition, active: false };
}

export function toggleSpeechComposition(composition: SpeechComposition, instruction: string): SpeechComposition {
  return composition.active ? stopSpeechComposition(composition) : beginSpeechComposition(instruction);
}

export function markManualSpeechEdit(composition: SpeechComposition): SpeechComposition {
  return stopSpeechComposition(composition);
}

export function applySpeechTranscript(
  composition: SpeechComposition,
  currentInstruction: string,
  text: string,
  isFinal: boolean,
): { state: SpeechComposition; instruction: string } {
  if (!composition.active) return { state: composition, instruction: currentInstruction };

  const instruction = `${composition.base}${composition.base && !composition.base.endsWith(' ') ? ' ' : ''}${text}`.replace(/\s+/g, ' ');
  return {
    state: isFinal ? { ...composition, base: instruction } : composition,
    instruction,
  };
}

export function canStartSpeech({
  enabled,
  isSupported,
  isRunning,
  hasError = false,
}: {
  enabled: boolean;
  isSupported: boolean;
  isRunning: boolean;
  hasError?: boolean;
}): boolean {
  return enabled && isSupported && !isRunning && !hasError;
}
