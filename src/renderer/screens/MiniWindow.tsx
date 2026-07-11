import { useState, useEffect, useRef } from 'react';
import { Play, Square, ExternalLink, Sparkles, X, Zap } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import type { LocalWorkflow } from '../../shared/types';

export function MiniWindow() {
  const [instruction, setInstruction] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    agentStatus,
    workflowRunState,
    currentAction,
    setActiveCommandId,
    setAgentStatus,
  } = useAgentStore();

  const { workflows, loadWorkflows } = useWorkflowStore();

  useEffect(() => {
    loadWorkflows();
    inputRef.current?.focus();

    const unsub = window.RemoteCtrlAPI?.on?.globalShortcut?.(() => {
      inputRef.current?.focus();
    });
    return () => { unsub && unsub(); };
  }, []);

  const isRunning =
    agentStatus === 'running' ||
    workflowRunState === 'running';

  const handleRunAgent = async () => {
    if (!instruction.trim() || isRunning) return;
    const text = instruction.trim();
    setInstruction('');
    setErrorMsg(null);

    const commandId = crypto.randomUUID();
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

  const handleRunWorkflow = async (wf: LocalWorkflow) => {
    if (isRunning) return;
    setErrorMsg(null);
    try {
      await window.RemoteCtrlAPI?.browser.launch();
      const workflowRunId = crypto.randomUUID();
      useAgentStore.getState().clearWorkflow();

      await window.RemoteCtrlAPI?.browser.startWorkflow({
        workflowRunId,
        workflowId: wf.id,
        name: wf.name,
        startUrl: wf.startUrl,
        steps: wf.steps,
      });
    } catch (err) {
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

  const quickWorkflows = workflows.slice(0, 3);

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

      {/* Live Status Card when active */}
      {isRunning && (
        <div className="mini-status-card animate-fade-in">
          <div className="mini-status-header">
            <span className="mini-status-dot animate-pulse" />
            <span className="mini-status-label truncate">
              {agentStatus === 'running'
                ? currentAction || 'Agent automating browser...'
                : 'Workflow automating browser...'}
            </span>
          </div>
          <button className="mini-watch-btn" onClick={handleOpenMain}>
            Watch in Browser →
          </button>
        </div>
      )}

      {/* Quick-Run Workflows */}
      <div className="mini-workflows-section">
        <div className="mini-workflows-header">
          <span className="mini-section-label">Quick-Run Workflows</span>
        </div>
        <div className="mini-workflows-grid">
          {quickWorkflows.length > 0 ? (
            quickWorkflows.map((wf) => (
              <button
                key={wf.id}
                className="mini-workflow-card"
                onClick={() => handleRunWorkflow(wf)}
                disabled={isRunning}
                title={wf.description || wf.name}
              >
                <Zap size={13} className="mini-wf-icon" />
                <div className="mini-wf-info">
                  <span className="mini-wf-name truncate">{wf.name}</span>
                  <span className="mini-wf-steps">{wf.steps.length} steps</span>
                </div>
              </button>
            ))
          ) : (
            <div className="mini-empty-workflows">
              <span>Save workflows in the full app for one-click shortcuts here.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
