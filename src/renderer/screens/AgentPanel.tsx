/**
 * @file AgentPanel.tsx
 * @description Side panel component facilitating human-in-the-loop interaction with the AI Browser Agent.
 * Renders user/agent chat bubbles, warning banners, step-by-step collapsable logs, and interactive checkpoint forms.
 * Triggers agent actions locally via window.RemoteCtrlAPI.browser commands, or sends prompts/responses over WebRTC (via sendData) in controller mode.
 * Features a workflow recorder converting RecordedAgentSteps to WorkflowSteps, passing data to the editor modal.
 * Key exports: AgentPanel (function component).
 */

import { useEffect, useRef, useState } from 'react';
import { Bot, Zap, MousePointer, Globe, Eye, FileText, CheckCircle2, ChevronDown, Edit3, Keyboard, ArrowUpDown, Search, CircleDot, Copy, RotateCcw, Save, X, Sparkles } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import type { ChatMessage } from '../stores/useAgentStore';
import type { AgentCheckpointPayload, PolicyApprovalRequest, TaskScope } from '../../shared/types';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import './AgentPanel.css';

export function AgentPanel() {
  const { 
    chatHistory,
    workflowRunState,
    recordingState,
    recordingSessionId,
    recordingTask,
    recordingStepCount,
    recordingError,
  } = useAgentStore();
  
  const { role, controllerState, hostState, sendData } = useConnectionStore();
  const chatEndRef = useRef<HTMLDivElement>(null);
  


  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, workflowRunState]);

  function handleSendPrompt(text: string) {
    if (!text) return;
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
      window.RemoteCtrlAPI?.browser.startAgent(payload);
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

  async function handleSaveRecording() {
    if (recordingState !== 'recording') return;
    useAgentStore.getState().setRecordingState({ recordingState: 'saving', recordingError: null });
    const result = await window.RemoteCtrlAPI?.browser.saveWorkflowRecording();
    if (result?.ok) {
      useAgentStore.getState().clearRecordingState();
      useAgentStore.getState().appendMessage({
        id: `recording-saved-${Date.now()}`,
        sender: 'agent',
        type: 'workflow',
        text: `Workflow saved: ${result.workflow?.name ?? 'Recorded workflow'}`,
        timestamp: Date.now(),
      });
    } else {
      useAgentStore.getState().setRecordingState({ recordingState: 'error', recordingError: result?.error ?? 'Unable to save workflow.' });
    }
  }

  async function handleDiscardRecording() {
    await window.RemoteCtrlAPI?.browser.discardWorkflowRecording();
    useAgentStore.getState().clearRecordingState();
  }

  const renderChatHistory = () => {
    const visibleMessages = chatHistory.filter((msg) => msg.type !== 'log');
    return visibleMessages.map((msg, index) => (
      <ChatBubble
        key={msg.id}
        msg={msg}
        onCheckpointResponse={handleCheckpointResponse}
        onEditMessage={(newInstruction) => {
              if (msg.sender === 'user') {
                const snapshotId = msg.id.replace('user-', '');
                const commandId = crypto.randomUUID();
                useAgentStore.getState().startNewExecution('agent', commandId, newInstruction);
                useAgentStore.getState().appendMessage({
                  id: `user-${commandId}`,
                  sender: 'user',
                  type: 'prompt',
                  text: newInstruction,
                  timestamp: Date.now(),
                });
                window.RemoteCtrlAPI?.browser.rewindAndRerunAgent({
                  snapshotId,
                  commandId,
                  action: 'act',
                  newInstruction,
                  executionMode: role === 'local' ? 'local' : 'remote',
                });
              }
            }}
        onRetry={msg.isFinal ? () => {
          const priorPrompt = visibleMessages.slice(0, index).reverse().find((entry) => entry.sender === 'user' && entry.type === 'prompt');
          if (priorPrompt) handleSendPrompt(priorPrompt.text);
        } : undefined}
      />
    ));
  };

  return (
    <div className="agent-panel">
      {recordingState !== 'idle' && (
        <section className="agent-recording-banner" aria-live="polite">
          <div className="agent-recording-copy">
            <div className="agent-recording-title"><span className="agent-recording-dot" /> Recording workflow</div>
            <div className="agent-recording-task">{recordingTask || 'Capturing agent actions'} · {recordingStepCount} captured step{recordingStepCount === 1 ? '' : 's'}</div>
            {recordingError && <div className="agent-recording-error">{recordingError}</div>}
          </div>
          <div className="agent-recording-actions">
            <button className="btn btn-primary btn-sm" disabled={recordingState !== 'recording' || recordingStepCount === 0} onClick={() => void handleSaveRecording()}><Save size={13} /> Save workflow</button>
            <button className="btn btn-ghost btn-sm" disabled={recordingState === 'saving'} onClick={() => void handleDiscardRecording()}><X size={13} /> Discard</button>
          </div>
        </section>
      )}
      <ScopeGuard role={role} />
      <div className="agent-chat-area">
        {chatHistory.length === 0 && workflowRunState === 'idle' && (
          <div className="agent-chat-empty">
            <div className="agent-ready-mark"><Bot size={20} /></div>
            <div className="agent-ready-kicker"><Sparkles size={12} /> Browser coworker ready</div>
            <div className="agent-ready-title">What should we work on?</div>
            <div className="agent-ready-copy">Describe the outcome you want. The agent will show each browser step and pause when it needs you.</div>
            
            <div className="agent-suggestions">
              <button 
                className="btn btn-ghost" 
                aria-label="Try: find the top AI story on Hacker News"
                onClick={() => handleSendPrompt('Go to hackernews and find the top story about AI')}
              >
                <Globe size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} /> Find top AI story on HackerNews
              </button>
              <button 
                className="btn btn-ghost" 
                aria-label="Try: search flights to Miami"
                onClick={() => handleSendPrompt('Go to google flights and find a weekend trip from NYC to MIA')}
              >
                <MousePointer size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} /> Search flights to Miami
              </button>
              <button 
                className="btn btn-ghost" 
                aria-label="Try: extract article text"
                onClick={() => handleSendPrompt('Extract the main article text from this page')}
              >
                <FileText size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} /> Extract article text
              </button>
            </div>
          </div>
        )}

        {renderChatHistory()}

        <div ref={chatEndRef} />
      </div>

    </div>
  );
}

function PromptActivity({ activities }: { activities: NonNullable<ChatMessage['activity']> }) {
  const [expanded, setExpanded] = useState(true);
  const hasRunning = activities.some((activity) => activity.state === 'running');

  if (!activities.length) return null;
  return <section className="agent-activity prompt-activity" aria-live="polite">
    <button className="agent-activity-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <Bot size={15} />
      <span>{hasRunning ? 'Working on this request…' : 'Activity'}</span>
      <ChevronDown className={expanded ? 'expanded' : ''} size={15} />
    </button>
    {expanded && <div className="agent-activity-list">
      {activities.map((activity) => <div className={`agent-activity-row ${activity.state}`} key={activity.id}>
        <ActivityIcon text={activity.text} />
        <span>{activity.text}</span>
      </div>)}
    </div>}
  </section>;
}

function ActivityIcon({ text }: { text: string }) {
  const value = text.toLowerCase();
  if (/navig|open/.test(value)) return <Globe size={13} />;
  if (/read|observ|analy/.test(value)) return <Eye size={13} />;
  if (/find|look|search/.test(value)) return <Search size={13} />;
  if (/enter|typ|fill|select/.test(value)) return <Edit3 size={13} />;
  if (/check|verif/.test(value)) return <CheckCircle2 size={13} />;
  if (/click|scroll|action/.test(value)) return <MousePointer size={13} />;
  return <CircleDot size={13} />;
}

function ScopeGuard({ role }: { role: 'idle' | 'host' | 'controller' | 'local' }) {
  const isLocal = role === 'local';
  const isHost = role === 'host';
  const [scope, setScope] = useState<TaskScope | null>(null);
  const [goal, setGoal] = useState('');
  const [domains, setDomains] = useState('');
  const [pending, setPending] = useState<PolicyApprovalRequest[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    const refreshScope = () => window.RemoteCtrlAPI?.policy.getScope().then((loaded) => {
      if (!mounted) return;
      setScope(loaded);
      setGoal(loaded.goal);
      setDomains(loaded.allowedDomains.join(', '));
    }).catch(() => setMessage('Unable to load task scope.'));
    refreshScope();
    const unsubscribe = window.RemoteCtrlAPI?.on.policyApprovalRequested((approval) => {
      setPending((current) => current.some((item) => item.approval.id === approval.approval.id) ? current : [...current, approval]);
    });
    const unsubscribeAudit = window.RemoteCtrlAPI?.on.policyAudit((event) => {
      if (event.type === 'scope.changed') void refreshScope();
    });
    return () => { mounted = false; unsubscribe?.(); unsubscribeAudit?.(); };
  }, []);

  async function saveScope() {
    if (!scope) return;
    const allowedDomains = domains.split(',').map((domain) => domain.trim()).filter(Boolean);
    const next = { ...scope, goal: goal.trim(), allowedDomains: allowedDomains.length ? allowedDomains : ['*'] };
    const result = await window.RemoteCtrlAPI?.policy.setScope(next);
    if (result?.ok) {
      setScope(next);
      setMessage('Scope saved. Protected actions now require host approval.');
    } else {
      setMessage(result?.error ?? 'Unable to save scope.');
    }
  }

  async function resolve(approvalId: string, approved: boolean) {
    await window.RemoteCtrlAPI?.policy.approve(approvalId, approved);
    setPending((current) => current.filter((item) => item.approval.id !== approvalId));
  }

  if (isLocal) {
    return <section style={{ margin: '10px 12px 0', border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg-elevated)', fontSize: 12, color: 'var(--text-secondary)' }}>
      <strong style={{ color: 'var(--accent)' }}>Local session</strong> · direct control is enabled; remote task scope is inactive.
    </section>;
  }
  if (role === 'controller') {
    return <section style={{ margin: '10px 12px 0', border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg-elevated)', fontSize: 12, color: 'var(--text-secondary)' }}>
      <strong style={{ color: 'var(--accent)' }}>Controller session</strong> · commands are evaluated by the host’s task scope. The host receives and resolves protected-action approvals.
    </section>;
  }

  return (
    <section style={{ margin: '10px 12px 0', border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg-elevated)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>Task Scope · hard action gate</strong>
        <span style={{ fontSize: 11, color: 'var(--accent)' }}>ENFORCED IN MAIN PROCESS</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          aria-label="Task goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          disabled={!isHost}
          placeholder="What should the operator accomplish?"
          style={{ minWidth: 0, flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          aria-label="Allowed domains"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          disabled={!isHost}
          placeholder="example.com, *.example.org"
          style={{ minWidth: 0, flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
        />
        {isHost && <button className="btn btn-sm" onClick={() => void saveScope()}>Save scope</button>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
        {isHost
          ? 'Host-owned remote scope. In-scope navigation can continue automatically; typing, arbitrary clicks, keys, and tab changes pause for approval.'
          : 'Scope becomes editable when this session is hosted.'}
      </div>
      {message && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5 }}>{message}</div>}
      {pending.map((approval) => (
        <div key={approval.approval.id} style={{ marginTop: 10, padding: 9, borderRadius: 7, background: 'rgba(245, 158, 11, .13)', border: '1px solid rgba(245, 158, 11, .35)' }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>Approval required · {approval.capability}</div>
          <div style={{ fontSize: 12, marginTop: 3 }}>{approval.action}</div>
          {approval.url && <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflowWrap: 'anywhere', marginTop: 3 }}>{approval.url}</div>}
          {isHost ? <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => void resolve(approval.approval.id, true)}>Approve once</button>
            <button className="btn btn-sm btn-ghost" onClick={() => void resolve(approval.approval.id, false)}>Block</button>
          </div> : <div style={{ fontSize: 11, marginTop: 7 }}>Waiting for the host to decide.</div>}
        </div>
      ))}
    </section>
  );
}

function ChatBubble({
  msg,
  onCheckpointResponse,
  onEditMessage,
  onRetry,
}: {
  msg: ChatMessage;
  onCheckpointResponse?: (checkpointId: string, optionId: string) => void;
  onEditMessage?: (newInstruction: string) => void;
  onRetry?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(msg.text);
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
    const isObs = msg.text.startsWith('Observing');
    const isExt = msg.text.startsWith('Extracting');
    const isDone = msg.text.startsWith('Completing');
    const isFill = msg.text.startsWith('Action: fill') || msg.text.startsWith('Action: type');
    const isPress = msg.text.startsWith('Action: press') || msg.text.startsWith('Action: keys');
    const isScroll = msg.text.startsWith('Action: scroll');
    const isAct = msg.text.startsWith('Action:');

    const icon = isNav ? (
      <Globe size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
    ) : isFill ? (
      <Edit3 size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
    ) : isPress ? (
      <Keyboard size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
    ) : isScroll ? (
      <ArrowUpDown size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
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
      <div className={`agent-msg-bubble ${isUser ? 'user' : 'agent'}`} style={{ position: 'relative' }}>
        {isEditing ? (
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              setIsEditing(false);
              if (editText.trim() && editText !== msg.text) {
                onEditMessage?.(editText);
              }
            }}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="agent-prompt-input"
              style={{ padding: '8px', background: 'var(--bg-card)', minHeight: '60px' }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setIsEditing(false); setEditText(msg.text); }}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm">Resubmit</button>
            </div>
          </form>
        ) : (
          <>
            <MarkdownRenderer content={msg.text} />
            {msg.isFinal && !isUser && (
              <div className="agent-completion-actions">
                <button onClick={() => void navigator.clipboard.writeText(msg.text)} title="Copy response"><Copy size={13} /> Copy</button>
                {onRetry && <button onClick={onRetry} title="Retry this request"><RotateCcw size={13} /> Retry</button>}
              </div>
            )}
            {isUser && onEditMessage && (
              <button 
                className="agent-msg-edit-btn"
                onClick={() => {
                  setEditText(msg.text);
                  setIsEditing(true);
                }}
                title="Edit message & rewind"
                style={{
                  position: 'absolute',
                  top: '-10px',
                  right: '-10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '50%',
                  padding: '4px',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                <Edit3 size={12} />
              </button>
            )}
          </>
        )}
      </div>
      {isUser && msg.type === 'prompt' && <PromptActivity activities={msg.activity ?? []} />}
    </div>
  );
}
