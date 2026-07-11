import { useState, useEffect, useRef } from 'react';
import { Play, Square, ExternalLink, Sparkles, X, Activity } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';

export function MiniWindow() {
  const [instruction, setInstruction] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    agentStatus,
    workflowRunState,
    currentAction,
    executionLogs,
    currentStepIndex,
    setActiveCommandId,
    setAgentStatus,
  } = useAgentStore();

  useEffect(() => {
    inputRef.current?.focus();

    const store = useAgentStore.getState();
    const unsubs = [
      window.RemoteCtrlAPI?.on?.globalShortcut?.(() => inputRef.current?.focus()),
      window.RemoteCtrlAPI?.on?.workflowRunStatus?.((status) => store.handleWorkflowRunStatus(status)),
      window.RemoteCtrlAPI?.on?.workflowStepStatus?.((status) => store.handleWorkflowStepStatus(status)),
      window.RemoteCtrlAPI?.on?.agentStatus?.((payload) => store.handleAgentStatus(payload)),
      window.RemoteCtrlAPI?.on?.agentLog?.((payload) => store.handleAgentLog(payload)),
    ];
    return () => {
      unsubs.forEach((u) => u && u());
    };
  }, []);

  const isRunning =
    agentStatus === 'running' ||
    workflowRunState === 'running';

  const latestLog = executionLogs.length > 0
    ? executionLogs[executionLogs.length - 1].message
    : null;

  const handleRunAgent = async () => {
    if (!instruction.trim() || isRunning) return;
    const text = instruction.trim();
    setInstruction('');
    setErrorMsg(null);

    const commandId = crypto.randomUUID();
    useAgentStore.getState().startNewExecution('agent', commandId, text);
    try {
      await window.RemoteCtrlAPI?.browser.launch();
      await window.RemoteCtrlAPI?.browser.startAgent({
        commandId,
        action: 'act',
        instruction: text,
      });
      setActiveCommandId(commandId);
      setAgentStatus('running');
    } catch (err) {
      setAgentStatus('idle');
      setErrorMsg(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStop = async () => {
    if (agentStatus === 'running') {
      window.RemoteCtrlAPI?.browser.cancelAgent();
    }
    if (workflowRunState === 'running') {
      window.RemoteCtrlAPI?.browser.cancelWorkflow();
    }
  };

  const handleOpenMain = () => {
    window.RemoteCtrlAPI?.app.showMainWindow();
  };

  const handleHideMini = () => {
    window.RemoteCtrlAPI?.app.hideMiniWindow();
  };

  return (
    <div className="mini-window-root">
      {/* Drag Header */}
      <div className="mini-window-header drag-region">
        <div className="mini-window-title">
          <span className="mini-logo-icon"><Sparkles size={13} /></span>
          <span className="mini-title-text">RemoteCtrl</span>
          <span className="badge badge-accent" style={{ fontSize: 9 }}>MINI</span>
        </div>
        <div className="mini-window-actions no-drag">
          <button className="mini-header-btn" onClick={handleOpenMain} title="Open Full Window">
            <ExternalLink size={13} />
            <span>View Browser</span>
          </button>
          <button className="mini-close-btn" onClick={handleHideMini} title="Hide">
            <X size={14} />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{ color: 'var(--status-error)', fontSize: 11, padding: '4px 12px' }}>
          {errorMsg}
        </div>
      )}

      {/* Main Spotlight Input */}
      <div className="mini-input-bar">
        <input
          ref={inputRef}
          type="text"
          className="mini-prompt-input"
          placeholder="What would you like to automate? Press Enter to run..."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRunAgent();
          }}
          disabled={isRunning}
        />
        {isRunning ? (
          <button className="mini-run-btn stop" onClick={handleStop} title="Stop">
            <Square size={14} />
          </button>
        ) : (
          <button
            className="mini-run-btn"
            onClick={handleRunAgent}
            disabled={!instruction.trim()}
            title="Run Agent"
          >
            <Play size={14} />
          </button>
        )}
      </div>

      {/* Enhanced Live Status Card when active */}
      {isRunning && (
        <div className="mini-status-card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="mini-status-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <span className="mini-status-dot animate-pulse" />
              <span className="mini-status-label truncate" style={{ fontWeight: 600 }}>
                {agentStatus === 'running'
                  ? 'AI Agent Running'
                  : `Workflow Running ${currentStepIndex !== null ? `(Step ${currentStepIndex + 1})` : ''}`}
              </span>
            </div>
            <button className="mini-watch-btn" onClick={handleOpenMain} style={{ flexShrink: 0 }}>
              Watch in Browser →
            </button>
          </div>

          <div
            style={{
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Activity size={12} className="animate-pulse" color="var(--accent)" style={{ flexShrink: 0 }} />
            <span className="truncate">
              {latestLog || currentAction || 'Executing automation commands...'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
