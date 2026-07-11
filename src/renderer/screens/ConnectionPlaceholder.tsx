import { useEffect, useState } from 'react';
import { Zap, Play, Radio, ArrowRight } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useUIStore } from '../stores/useUIStore';
import type { LocalWorkflow } from '../../shared/types';

export function ConnectionPlaceholder() {
  const [pinInput, setPinInput] = useState('');
  const { setRole } = useConnectionStore();
  const { workflows, loadWorkflows } = useWorkflowStore();
  const { setRightPanelTab } = useUIStore();

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  function handleLocal() {
    setRole('local');
    window.RemoteCtrlAPI?.browser.launch();
    window.RemoteCtrlAPI?.app.showMiniWindow(true);
  }

  async function handleQuickRunWorkflow(workflow: LocalWorkflow) {
    setRole('local');
    try {
      await window.RemoteCtrlAPI?.browser.launch();
    } catch (err) {
      setRole('idle');
      alert(`Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const workflowRunId = crypto.randomUUID();
    useAgentStore.getState().clearWorkflow();

    window.RemoteCtrlAPI?.browser.startWorkflow({
      workflowRunId,
      workflowId: workflow.id,
      name: workflow.name,
      startUrl: workflow.startUrl,
      steps: workflow.steps,
    });

    setRightPanelTab('agent');
  }

  function handleHost() {
    setRole('host');
    window.RemoteCtrlAPI?.host.start();
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pinInput.replace(/\D/g, '');
    if (cleaned.length === 9) {
      setRole('controller');
      window.RemoteCtrlAPI?.controller.connect(cleaned);
    }
  }

  return (
    <div className="connection-placeholder">
      <div className="cp-icon">
        <Zap size={40} strokeWidth={1.5} color="var(--accent)" />
      </div>

      <h2 className="cp-title">Start Automating</h2>
      <p className="cp-subtitle">
        Run AI automation locally on your machine or execute saved workflows.
      </p>

      <button
        className="btn btn-primary glow-accent"
        style={{ width: '100%', padding: '12px', fontSize: '15px', fontWeight: 600 }}
        onClick={handleLocal}
      >
        Start Local Session
      </button>

      {workflows.length > 0 && (
        <div style={{ width: '100%', marginTop: '24px', textAlign: 'left' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '10px', letterSpacing: '0.08em' }}>
            QUICK-RUN SAVED WORKFLOWS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(workflows.slice(0,4).length, 2)}, 1fr)`, gap: '8px' }}>
            {workflows.slice(0, 4).map((wf) => (
              <div
                key={wf.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '2px' }}>{wf.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ alignSelf: 'flex-start', color: 'var(--accent)', padding: '4px 8px', gap: '4px' }}
                  onClick={() => handleQuickRunWorkflow(wf)}
                >
                  <Play size={11} /> Run Now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="cp-divider" style={{ margin: '28px 0 20px' }}>
        <div className="cp-divider-line"></div>
        <span className="cp-divider-text">Remote Control</span>
        <div className="cp-divider-line"></div>
      </div>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          className="btn btn-outline"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          onClick={handleHost}
        >
          <Radio size={15} /> Host your browser for remote session
        </button>

        <form onSubmit={handleJoin} className="cp-pin-form">
          <input
            type="text"
            className="cp-pin-input"
            placeholder="PIN (9 digits)"
            value={pinInput}
            maxLength={9}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="submit"
            className={`btn cp-join-btn ${pinInput.length === 9 ? 'btn-primary' : 'btn-ghost'}`}
            disabled={pinInput.length !== 9}
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Join <ArrowRight size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
