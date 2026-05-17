import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, MousePointer, Hand, Send, BookOpen, Loader2 } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useAgentStore } from '../stores/useAgentStore';
import type { ChatMessage } from '../stores/useAgentStore';

export function ControllerSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { controllerState, error, reset } = useConnectionStore();
  const { isTakeoverActive, agentStatus, chatHistory, setTakeoverActive } = useAgentStore();
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const pin = (location.state as { pin?: string })?.pin ?? '';

  useEffect(() => {
    if (pin) {
      window.remconAPI?.controller.connect(pin);
    }
  }, [pin]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  async function handleDisconnect() {
    await window.remconAPI?.controller.disconnect();
    reset();
    navigate('/');
  }

  function handleToggleTakeover() {
    setTakeoverActive(!isTakeoverActive);
  }

  function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    // Phase 4: send over WebRTC data channel
    // For now just log to chat
    useAgentStore.getState().appendMessage({
      id: `user-${Date.now()}`,
      sender: 'user',
      type: 'prompt',
      text: prompt.trim(),
      timestamp: Date.now(),
    });
    setPrompt('');
  }

  const isConnected = controllerState === 'SESSION_ACTIVE' || controllerState === 'CONTROLLING_REMOTELY';
  const isConnecting = ['SIGNALING_CONNECTING', 'WAITING_FOR_HOST_APPROVAL', 'WEBRTC_CONNECTING'].includes(controllerState);

  return (
    <div className="ctrl-root">
      {/* Top bar */}
      <div className="ctrl-topbar drag-region">
        <div className="ctrl-topbar-left no-drag">
          <div className={`ctrl-dot ${isConnected ? 'ctrl-dot-on' : 'ctrl-dot-off'}`} />
          <span className="ctrl-status-text">
            {isConnecting ? 'Connecting…' : isConnected ? 'Connected' : controllerState === 'DISCONNECTED' ? 'Disconnected' : `PIN ${pin}`}
          </span>
        </div>
        <div className="ctrl-topbar-right no-drag">
          {/* Takeover toggle */}
          <button
            className={`btn ${isTakeoverActive ? 'btn-takeover-active' : 'btn-takeover'}`}
            onClick={handleToggleTakeover}
            title="Toggle manual control"
          >
            {isTakeoverActive ? <Hand size={14} /> : <MousePointer size={14} />}
            {isTakeoverActive ? 'Release' : 'Takeover'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/workflows')}
            title="Workflow library"
          >
            <BookOpen size={14} /> Workflows
          </button>
          <button className="btn btn-ghost" onClick={handleDisconnect}>
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="ctrl-body">
        {/* Video pane */}
        <div className="ctrl-video-pane">
          {isConnecting ? (
            <div className="ctrl-connecting">
              <Loader2 size={32} className="animate-spin" />
              <div className="ctrl-connecting-text">Connecting…</div>
            </div>
          ) : isConnected ? (
            <>
              {/* Phase 2: <video> element goes here */}
              <div className="ctrl-video-placeholder">
                <div className="ctrl-video-placeholder-inner">
                  <Monitor32 />
                  <div>Video stream will appear here in Phase 2</div>
                </div>
              </div>
              {/* Takeover overlay — Phase 3: capture mouse/keyboard events */}
              {isTakeoverActive && <div className="ctrl-takeover-overlay" />}
            </>
          ) : (
            <div className="ctrl-connecting">
              <div className="ctrl-connecting-text ctrl-connecting-text--dim">
                {error ?? 'Not connected'}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="ctrl-sidebar">
          {/* Chat history */}
          <div className="ctrl-chat">
            {chatHistory.length === 0 ? (
              <div className="ctrl-chat-empty">
                Send a prompt to control the remote browser
              </div>
            ) : (
              chatHistory.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Agent status badge */}
          {agentStatus !== 'idle' && (
            <div className="ctrl-agent-status">
              {agentStatus === 'running' && <Loader2 size={12} className="animate-spin" />}
              <span className={`badge badge-${agentStatus === 'running' ? 'accent' : agentStatus === 'error' ? 'danger' : 'success'}`}>
                Agent {agentStatus}
              </span>
            </div>
          )}

          {/* Prompt input */}
          <form className="ctrl-prompt-form" onSubmit={handleSendPrompt}>
            <textarea
              className="ctrl-prompt-input"
              placeholder={isConnected ? 'Describe what to do…' : 'Waiting for connection…'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={!isConnected || agentStatus === 'running'}
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSendPrompt(e as any);
                }
              }}
            />
            <button
              type="submit"
              className="btn btn-primary ctrl-send-btn"
              disabled={!isConnected || !prompt.trim() || agentStatus === 'running'}
            >
              <Send size={14} />
              Send
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .ctrl-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
        }
        .ctrl-topbar {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-surface);
          flex-shrink: 0;
        }
        .ctrl-topbar-left, .ctrl-topbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ctrl-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
        }
        .ctrl-dot-on  { background: var(--success); }
        .ctrl-dot-off { background: var(--text-muted); }
        .ctrl-status-text { font-size: 12px; color: var(--text-secondary); }
        .ctrl-body {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        .ctrl-video-pane {
          flex: 1;
          position: relative;
          background: #05050a;
          overflow: hidden;
        }
        .ctrl-video-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ctrl-video-placeholder-inner {
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .ctrl-connecting {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-secondary);
        }
        .ctrl-connecting-text { font-size: 13px; }
        .ctrl-connecting-text--dim { color: var(--text-muted); }
        .ctrl-takeover-overlay {
          position: absolute;
          inset: 0;
          cursor: crosshair;
          border: 2px solid var(--danger);
        }
        .ctrl-sidebar {
          width: 300px;
          flex-shrink: 0;
          border-left: 1px solid var(--border);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
        }
        .ctrl-chat {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ctrl-chat-empty {
          margin: auto;
          text-align: center;
          font-size: 12px;
          color: var(--text-muted);
          padding: 24px;
          line-height: 1.6;
        }
        .ctrl-agent-status {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-top: 1px solid var(--border);
        }
        .ctrl-prompt-form {
          padding: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ctrl-prompt-input {
          width: 100%;
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: 13px;
          padding: 8px 12px;
          resize: none;
          outline: none;
          transition: border-color var(--transition);
          line-height: 1.5;
        }
        .ctrl-prompt-input:focus { border-color: var(--accent); }
        .ctrl-prompt-input:disabled { opacity: 0.5; }
        .ctrl-send-btn { align-self: flex-end; }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 32px; padding: 0 12px; border-radius: var(--radius-sm);
          font-size: 12px; font-weight: 600; cursor: pointer; border: none;
          transition: background var(--transition), opacity var(--transition), transform var(--transition);
          white-space: nowrap;
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary  { background: var(--accent); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .btn-ghost    { background: transparent; color: var(--text-secondary); }
        .btn-ghost:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .btn-takeover { background: var(--bg-overlay); color: var(--text-secondary); border: 1px solid var(--border); }
        .btn-takeover:hover { border-color: var(--danger); color: var(--danger); }
        .btn-takeover-active { background: rgba(239,68,68,0.15); color: var(--danger); border: 1px solid rgba(239,68,68,0.5); }
        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;
          letter-spacing: 0.03em; text-transform: uppercase;
        }
        .badge-accent  { background: var(--accent-glow); color: var(--accent); }
        .badge-danger  { background: rgba(239,68,68,0.15); color: var(--danger); }
        .badge-success { background: rgba(34,197,94,0.15); color: var(--success); }
      `}</style>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.sender === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '80%',
        padding: '8px 12px',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        background: isUser ? 'var(--accent-glow)' : 'var(--bg-overlay)',
        border: `1px solid ${isUser ? 'rgba(124,106,247,0.3)' : 'var(--border)'}`,
        fontSize: '12px',
        lineHeight: '1.5',
        color: msg.type === 'log' ? 'var(--text-muted)' : 'var(--text-primary)',
        fontFamily: msg.type === 'log' ? 'var(--font-mono)' : 'inherit',
        wordBreak: 'break-word',
      }}>
        {msg.text}
      </div>
    </div>
  );
}

function Monitor32() {
  return (
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  );
}
