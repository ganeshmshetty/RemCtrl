import { useState, useRef, useEffect } from 'react';
import { Send, StopCircle, Plus, Hand, MousePointer } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';

export function ChatInputBar() {
  const { isTakeoverActive, setTakeoverActive, agentStatus } = useAgentStore();
  const { role, controllerState, hostState, sendData } = useConnectionStore();
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [prompt]);

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

    const payload = { commandId, action: 'act' as const, instruction: text };

    if (controllerState !== 'IDLE' && sendData) {
      sendData({
        type: 'AGENT_PROMPT',
        version: '1.0',
        timestamp: Date.now(),
        id: commandId,
        payload,
      }, true);
    } else if (hostState !== 'IDLE' || role === 'local') {
      window.RemoteCtrlAPI?.browser.startAgent(payload);
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

  return (
    <div className="chat-input-bar">
      <form onSubmit={handleSendPrompt} className="chat-prompt-form">
        <div className="chat-input-controls">
          <button 
            type="button"
            className="chat-control-icon-btn"
            title="Add attachment"
          >
            <Plus size={16} />
          </button>
          <button 
            type="button"
            className={`chat-control-icon-btn ${isTakeoverActive ? 'active' : ''}`}
            onClick={() => {
              const newActive = !isTakeoverActive;
              setTakeoverActive(newActive);
              window.RemoteCtrlAPI?.browser.setTakeoverActive?.(newActive);
            }}
            disabled={!isConnected}
            title={isTakeoverActive ? 'Release Control' : 'Takeover Browser'}
          >
            {isTakeoverActive ? <Hand size={16} /> : <MousePointer size={16} />}
          </button>
        </div>

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
        {agentStatus === 'running' ? (
          <button
            type="button"
            className="chat-prompt-send danger"
            onClick={handleCancelAgent}
            title="Stop execution"
          >
            <StopCircle size={18} />
          </button>
        ) : (
          <button
            type="submit"
            className="chat-prompt-send"
            disabled={!prompt.trim() || !isConnected}
            title="Send prompt"
          >
            <Send size={18} />
          </button>
        )}
      </form>
    </div>
  );
}
