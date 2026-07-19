import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, Plus, Hand, Mic, MicOff } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useSettingsStore } from '../stores/useWorkflowStore';
import { useSpeechToText } from '../hooks/useSpeechToText';

export function ChatInputBar() {
  const { agentStatus, isTakeoverActive, recordingState, recordingSessionId } = useAgentStore();
  const { role, controllerState, hostState, sendData } = useConnectionStore();
  const { microphoneAudioEnabled, speechInputMode, whisperSetup } = useSettingsStore();
  const [prompt, setPrompt] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const speechBaseRef = useRef('');

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    setPrompt(() => {
      const base = speechBaseRef.current;
      const next = `${base}${base && !base.endsWith(' ') ? ' ' : ''}${text}`.replace(/\s+/g, ' ');
      if (isFinal) speechBaseRef.current = next;
      return next;
    });
  }, []);
  const speech = useSpeechToText({ enabled: microphoneAudioEnabled, mode: speechInputMode, setup: whisperSetup, onTranscript: handleTranscript });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const maxHeight = 180;
      const nextHeight = Math.min(inputRef.current.scrollHeight, maxHeight);
      inputRef.current.style.height = `${nextHeight}px`;
      inputRef.current.style.overflowY = inputRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden';
      setIsExpanded(inputRef.current.scrollHeight > 42);
    }
  }, [prompt]);

  useEffect(() => {
    const focusInput = () => inputRef.current?.focus();
    window.addEventListener('remotectrl:focus-agent-input', focusInput);
    return () => window.removeEventListener('remotectrl:focus-agent-input', focusInput);
  }, []);

  const isConnected = 
    role === 'local' ||
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || !isConnected) return;

    const commandId = crypto.randomUUID();
    useAgentStore.getState().startNewExecution('agent', commandId, text);
    useAgentStore.getState().appendMessage({
      id: `user-${commandId}`,
      sender: 'user',
      type: 'prompt',
      text,
      timestamp: Date.now(),
    });

    const payload = {
      commandId,
      action: 'act' as const,
      instruction: text,
      executionMode: role === 'local' ? 'local' as const : 'remote' as const,
      recordingSessionId: recordingState === 'recording' ? recordingSessionId ?? undefined : undefined,
    };

    if (controllerState !== 'IDLE' && sendData) {
      sendData({
        type: 'AGENT_PROMPT',
        version: '1.0',
        timestamp: Date.now(),
        id: commandId,
        payload,
      }, true);
    } else if (hostState !== 'IDLE' || role === 'local') {
      void window.RemoteCtrlAPI?.browser.startAgent(payload).then((result) => {
        if (result?.ok) return;
        const error = result?.error ?? 'Unable to start the agent.';
        useAgentStore.getState().setAgentStatus('error');
        useAgentStore.getState().appendMessage({
          id: `error-${commandId}`,
          sender: 'agent',
          type: 'error',
          text: error,
          timestamp: Date.now(),
        });
        useAgentStore.getState().archiveCurrentRun('error', error);
      }).catch((error: unknown) => {
        useAgentStore.getState().setAgentStatus('error');
        useAgentStore.getState().appendMessage({
          id: `error-${commandId}`,
          sender: 'agent',
          type: 'error',
          text: error instanceof Error ? error.message : 'Unable to start the agent.',
          timestamp: Date.now(),
        });
        useAgentStore.getState().archiveCurrentRun('error', error instanceof Error ? error.message : undefined);
      });
    }

    setPrompt('');
  }

  function handleCancelAgent() {
    if (controllerState !== 'IDLE' && sendData) {
      sendData({ type: 'AGENT_PROMPT', version: '1.0', timestamp: Date.now(), payload: { commandId: '__cancel__', action: 'act', instruction: '' } }, true);
    } else if (hostState !== 'IDLE' || role === 'local') {
      window.RemoteCtrlAPI?.browser.cancelAgent();
    }
  }

  function startSpeech() {
    speechBaseRef.current = prompt.trim() ? `${prompt.trim()} ` : '';
    speech.start();
  }

  function stopSpeech() {
    speech.stop();
  }

  async function toggleTakeControl() {
    if (recordingState === 'recording' || recordingState === 'saving') return;
    const next = !isTakeoverActive;
    useAgentStore.getState().setTakeoverActive(next);
    await window.RemoteCtrlAPI?.browser.setTakeoverActive(next);
  }

  return (
    <div className={`chat-input-bar ${isExpanded ? 'is-expanded' : ''}`}>
      <form onSubmit={handleSendPrompt} className="chat-prompt-form">
        <textarea
          ref={inputRef}
          className="chat-prompt-input"
          placeholder={isConnected ? "What should I do?" : "Connect to a browser first..."}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendPrompt(e as unknown as React.FormEvent);
            }
          }}
          disabled={!isConnected}
          rows={1}
        />
        <div className="chat-prompt-footer">
          <div className="chat-input-controls">
            <button type="button" className="chat-control-icon-btn" title="Add attachment">
              <Plus size={16} />
            </button>
            {role === 'local' && !['recording', 'saving'].includes(recordingState) && (
              <button
                type="button"
                className={`chat-control-icon-btn ${isTakeoverActive ? 'active' : ''}`}
                onClick={() => void toggleTakeControl()}
                title={isTakeoverActive ? 'Resume agent' : 'Take control'}
              >
                <Hand size={16} />
              </button>
            )}
            {speechInputMode === 'push_to_talk' && (
              <button
                type="button"
                className={`chat-control-icon-btn ${speech.isListening ? 'active' : ''}`}
                onPointerDown={(event) => { event.preventDefault(); startSpeech(); }}
                onPointerUp={stopSpeech}
                onPointerCancel={stopSpeech}
                onPointerLeave={() => { if (speech.isListening) stopSpeech(); }}
                aria-label="Hold to dictate"
                title={speech.error ?? 'Hold to dictate'}
                disabled={!speech.isSupported}
              >
                {speech.isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}
            {speechInputMode === 'hands_free' && (
              <button
                type="button"
                className={`chat-control-icon-btn ${speech.isListening ? 'active' : ''}`}
                onClick={() => speech.isListening ? stopSpeech() : startSpeech()}
                aria-label={speech.isListening ? 'Stop dictation' : 'Start dictation'}
                title={speech.error ?? (speech.isListening ? 'Stop dictation' : 'Start dictation')}
                disabled={!speech.isSupported && !speech.isListening}
              >
                {speech.isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}
          </div>
          {agentStatus === 'running' ? (
            <button type="button" className="chat-prompt-send danger" onClick={handleCancelAgent} title="Stop execution">
              <StopCircle size={18} />
            </button>
          ) : (
            <button type="submit" className="chat-prompt-send" disabled={!prompt.trim() || !isConnected} title="Send prompt">
              <Send size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
