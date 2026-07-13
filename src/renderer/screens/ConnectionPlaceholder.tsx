/**
 * @file ConnectionPlaceholder.tsx
 * @description Main dashboard interface displayed to users when the active session role is 'idle'.
 * Serves as the primary landing page offering quick-start controls for local browser session activation, hosting a screen share (Host mode), or inputting a remote PIN (Controller mode).
 * Features a workflow registry displaying available saved workflows, allowing immediate automated playback on the local browser.
 * Integrates with Zustand stores (useConnectionStore, useWorkflowStore, useAgentStore, useUIStore) and delegates system-level commands to RemoteCtrlAPI.
 * Key exports: ConnectionPlaceholder (function component).
 */

import { useEffect, useState } from 'react';
import { Zap, Play, Radio, Plus, FolderPlus, ArrowRight } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useUIStore } from '../stores/useUIStore';
import type { LocalWorkflow } from '../../shared/types';

export function ConnectionPlaceholder() {
  const [pinInput, setPinInput] = useState('');
  const { setRole } = useConnectionStore();
  const { workflows, loadWorkflows } = useWorkflowStore();
  const { setRightPanelTab, openWorkflowEditor } = useUIStore();

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  function handleLocal() {
    setRole('local');
    window.RemoteCtrlAPI?.browser.launch();
    window.RemoteCtrlAPI?.app.showMiniWindow(true);
  }

  function handleCreateWorkflow() {
    openWorkflowEditor();
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
    useAgentStore.getState().startNewExecution('workflow', workflowRunId, workflow.name);

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
    <div className="connection-placeholder" style={{ maxWidth: '680px' }}>
      {/* Top Hero Section */}
      <div className="cp-icon">
        <Zap size={36} strokeWidth={1.75} color="var(--accent)" />
      </div>

      <h2 className="cp-title">Start Automating</h2>
      <p className="cp-subtitle">
        Run AI automation locally on your machine or execute saved workflows.
      </p>

      <button
        className="btn btn-primary glow-accent"
        style={{ width: '100%', maxWidth: '380px', padding: '12px 20px', fontSize: '15px', fontWeight: 600, marginBottom: '32px' }}
        onClick={handleLocal}
      >
        Start Local Session
      </button>

      {/* Workflows Section */}
      <div style={{ width: '100%', marginBottom: '32px', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            SAVED WORKFLOWS ({workflows.length})
          </div>
          <button
            className="btn btn-sm btn-outline"
            style={{ padding: '4px 10px', fontSize: '12px', gap: '6px', color: 'var(--text-primary)' }}
            onClick={handleCreateWorkflow}
          >
            <Plus size={13} /> New Workflow
          </button>
        </div>

        {workflows.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            {workflows.slice(0, 6).map((wf) => (
              <div
                key={wf.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div>
                  <div className="truncate" style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {wf.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {wf.steps.length} step{wf.steps.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ alignSelf: 'flex-start', color: 'var(--accent)', padding: '4px 8px', gap: '4px', background: 'rgba(99,102,241,0.08)' }}
                  onClick={() => handleQuickRunWorkflow(wf)}
                >
                  <Play size={11} /> Run Now
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              background: 'var(--bg-secondary)',
              border: '1px dashed var(--border)',
              borderRadius: 'var(--radius)',
              padding: '24px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <FolderPlus size={24} color="var(--text-muted)" />
            <span>No saved workflows yet</span>
            <button
              className="btn btn-sm btn-ghost"
              style={{ color: 'var(--accent)', marginTop: '4px' }}
              onClick={handleCreateWorkflow}
            >
              + Create your first workflow
            </button>
          </div>
        )}
      </div>

      {/* Remote Control Section */}
      <div className="cp-divider" style={{ margin: '12px 0 20px' }}>
        <div className="cp-divider-line"></div>
        <span className="cp-divider-text">Remote Control</span>
        <div className="cp-divider-line"></div>
      </div>

      <div style={{ width: '100%', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
        <button
          className="btn btn-outline"
          style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px' }}
          onClick={handleHost}
        >
          <Radio size={15} /> Host browser session
        </button>

        <form onSubmit={handleJoin} className="cp-pin-form" style={{ flex: '1 1 240px' }}>
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

