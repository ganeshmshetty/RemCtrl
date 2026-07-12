import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Zap, StopCircle, Hand, MousePointer, Save, Loader2, Globe, Eye, FileText, CheckCircle2, ChevronDown } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useUIStore } from '../stores/useUIStore';
import type { ChatMessage } from '../stores/useAgentStore';
import type { AgentCheckpointPayload } from '../../shared/types';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

export function AgentPanel() {
  const { 
    chatHistory, isTakeoverActive, setTakeoverActive, 
    workflowRunState, workflowRunId, workflowStepStatuses,
    agentStatus, currentAction
  } = useAgentStore();
  
  const { role, controllerState, hostState, sendData } = useConnectionStore();
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const isConnected = 
    role === 'local' ||
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, workflowRunState]);

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

  function handleCheckpointResponse(checkpointId: string, selectedOptionId: string) {
    if (controllerState !== 'IDLE' && sendData) {
      sendData({
        type: 'AGENT_CHECKPOINT_RESPONSE',
        version: '1.0',
        timestamp: Date.now(),
        payload: { checkpointId, response: { selectedOptionId } },
      }, true);
    } else if (hostState !== 'IDLE' || role === 'local') {
      window.RemoteCtrlAPI?.browser.submitCheckpoint(checkpointId, { selectedOptionId });
    }
  }

  function handleTakeover() {
    setTakeoverActive(true);
  }

  const renderChatHistory = () => {
    const rendered: React.ReactNode[] = [];
    let currentLogGroup: ChatMessage[] = [];

    const flushLogs = (key: string) => {
      if (currentLogGroup.length > 0) {
        const logs = [...currentLogGroup];
        rendered.push(
          <CollapsableLogs key={key} logs={logs} agentStatus={agentStatus} />
        );
        currentLogGroup = [];
      }
    };

    for (let i = 0; i < chatHistory.length; i++) {
      const msg = chatHistory[i];
      if (msg.type === 'log') {
        currentLogGroup.push(msg);
      } else {
        flushLogs(`log-group-${i}`);
        rendered.push(
          <ChatBubble
            key={msg.id}
            msg={msg}
            onCheckpointResponse={handleCheckpointResponse}
            onTakeover={handleTakeover}
          />
        );
      }
    }
    flushLogs('log-group-end');
    return rendered;
  };

  return (
    <div className="agent-panel">
      <div className="agent-chat-area">
        {workflowRunState !== 'idle' && workflowRunId && (
          <div className="agent-workflow-status">
            <div className="agent-workflow-status-title">
              <Zap size={14} style={{ marginRight: 6 }} /> Workflow Status: {workflowRunState}
            </div>
            <div>
              {workflowStepStatuses.map((step, i) => (
                <div key={i} className="agent-workflow-step">
                  <span className={`agent-workflow-step-dot ${step.state}`}></span>
                  <span style={{ color: step.state === 'skipped' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    Step {step.index + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {chatHistory.length === 0 && workflowRunState === 'idle' && (
          <div className="agent-chat-empty">
            <Bot size={32} strokeWidth={1} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Agent is ready.</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Ask it to do something!</div>
          </div>
        )}

        {renderChatHistory()}
        
        {agentStatus === 'running' && (
          <div
            className="agent-executing-status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: 'var(--accent-glow)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius)',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontWeight: 500,
              margin: '8px 0',
            }}
          >
            <Loader2 className="animate-spin" size={14} style={{ color: 'var(--accent)' }} />
            <span>{currentAction || 'Executing task...'}</span>
          </div>
        )}
        
        {chatHistory.length > 0 && chatHistory[chatHistory.length - 1].type === 'status' && (
          <button className="btn btn-ghost agent-save-workflow-btn" onClick={() => useUIStore.getState().openWorkflowEditor()}>
            <Save size={14} style={{ marginRight: 4 }} /> Save as Workflow
          </button>
        )}
        
        <div ref={chatEndRef} />
      </div>

      <div className="agent-input-area">
        <div className="agent-controls">
          <button 
            className={`agent-control-btn ${isTakeoverActive ? 'active' : ''}`}
            onClick={() => setTakeoverActive(!isTakeoverActive)}
            disabled={!isConnected}
          >
            {isTakeoverActive ? <Hand size={14} /> : <MousePointer size={14} />}
            {isTakeoverActive ? 'Release' : 'Takeover'}
          </button>
        </div>

        <form onSubmit={handleSendPrompt} className="agent-prompt-form">
          <textarea
            className="agent-prompt-input"
            placeholder={isConnected ? "What should I do?" : "Connect to a browser first..."}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!isConnected}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendPrompt(e as any);
              }
            }}
          />
          {agentStatus === 'running' ? (
            <button
              type="button"
              className="agent-prompt-send danger"
              onClick={handleCancelAgent}
              title="Stop execution"
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              type="submit"
              className="agent-prompt-send"
              disabled={!prompt.trim() || !isConnected}
              title="Send prompt"
            >
              <Send size={18} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function ChatBubble({
  msg,
  onCheckpointResponse,
  onTakeover,
}: {
  msg: ChatMessage;
  onCheckpointResponse?: (checkpointId: string, optionId: string) => void;
  onTakeover?: () => void;
}) {
  const isUser = msg.sender === 'user';

  // Checkpoint — interactive option buttons
  if (msg.type === 'checkpoint' && msg.checkpointPayload) {
    const cp = msg.checkpointPayload as AgentCheckpointPayload;
    return (
      <div className="agent-msg">
        <div className="agent-msg-checkpoint">
          <div className="agent-msg-checkpoint-title">Agent Needs Input</div>
          <div className="agent-msg-checkpoint-question">{msg.text}</div>
          <div className="agent-msg-checkpoint-options">
            {cp.options.map((opt) => (
              <button
                key={opt.id}
                className={`agent-checkpoint-option ${opt.recommended ? 'recommended' : ''}`}
                onClick={() => onCheckpointResponse?.(cp.checkpointId, opt.id)}
              >
                <div className="agent-checkpoint-option-label">{opt.label}</div>
                {opt.description && (
                  <div className="agent-checkpoint-option-desc">{opt.description}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error message with Takeover button
  if (msg.type === 'error') {
    return (
      <div className="agent-msg">
        <div className="agent-msg-error-card">
          <div className="agent-msg-error-title">Task Failed</div>
          <div className="agent-msg-error-text">{msg.text}</div>
          <button className="btn btn-sm" style={{ background: 'var(--danger)', color: '#fff', marginTop: 8 }} onClick={onTakeover}>
            <Hand size={13} style={{ marginRight: 4 }} /> Takeover
          </button>
        </div>
      </div>
    );
  }

  // Workflow status update
  if (msg.type === 'workflow') {
    return (
      <div className="agent-msg">
        <div className="agent-msg-workflow">
          <Zap size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span>{msg.text}</span>
        </div>
      </div>
    );
  }

  // Log message (clean step pill)
  if (msg.type === 'log') {
    const isNav = msg.text.startsWith('Navigating');
    const isAct = msg.text.startsWith('Action:');
    const isObs = msg.text.startsWith('Observing');
    const isExt = msg.text.startsWith('Extracting');
    const isDone = msg.text.startsWith('Completing');

    const icon = isNav ? (
      <Globe size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    ) : isAct ? (
      <MousePointer size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
    ) : isObs ? (
      <Eye size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />
    ) : isExt ? (
      <FileText size={13} style={{ color: '#a855f7', flexShrink: 0 }} />
    ) : isDone ? (
      <CheckCircle2 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
    ) : (
      <Bot size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
    );

    return (
      <div className="agent-msg">
        <div
          className="agent-msg-step-pill"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ opacity: 0.7, display: 'flex', alignItems: 'center' }}>{icon}</div>
          <span style={{ fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 }}>
            {msg.text}
          </span>
        </div>
      </div>
    );
  }

  // Stall warning — visually distinct amber banner
  if (msg.type === 'warn') {
    return (
      <div className="agent-msg">
        <div className="agent-msg-warn">
          <span className="agent-msg-warn-icon">⚠️</span>
          <span>{msg.text}</span>
        </div>
      </div>
    );
  }

  // Standard user/agent bubble
  return (
    <div className={`agent-msg ${isUser ? 'user' : ''}`}>
      <div className={`agent-msg-bubble ${isUser ? 'user' : 'agent'}`}>
        <MarkdownRenderer content={msg.text} />
      </div>
    </div>
  );
}

function CollapsableLogs({ logs, agentStatus }: { logs: ChatMessage[]; agentStatus: string }) {
  const [isOpen, setIsOpen] = useState(agentStatus === 'running');

  useEffect(() => {
    if (agentStatus === 'running') {
      setIsOpen(true);
    }
  }, [agentStatus, logs.length]);

  return (
    <div className="agent-msg-logs-collapsable animate-fade-in" style={{ margin: '6px 0', width: '100%' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          padding: '4px 0',
          outline: 'none',
        }}
      >
        <div style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>
          <ChevronDown size={12} />
        </div>
        <span>
          {isOpen ? 'Hide' : 'Show'} {logs.length} execution step{logs.length > 1 ? 's' : ''}
        </span>
      </button>

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, paddingLeft: 12, borderLeft: '1px dashed var(--border)' }}>
          {logs.map((log) => (
            <ChatBubble key={log.id} msg={log} />
          ))}
        </div>
      )}
    </div>
  );
}
