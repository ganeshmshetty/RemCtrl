/**
 * @file WorkflowsPanel.tsx
 * @description Sidebar panel listing saved workflows and allowing execution triggering, viewing/editing, and deletion.
 * Uses useWorkflowStore to fetch, display, and manage stored workflow structures, and useUIStore to open the editor overlay.
 * Handles conditional execution routing: triggers workflow executions locally through window.RemoteCtrlAPI.browser.startWorkflow
 * if in local/host mode, or sends serialized agent workflow batches over the WebRTC data channel if in controller mode.
 * Key exports: WorkflowsPanel (function component).
 */

import { useEffect, useState } from 'react';
import { Play, Eye, Trash2, Wand2, Bot } from 'lucide-react';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useUIStore } from '../stores/useUIStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';

export function WorkflowsPanel() {
  const { workflows, isLoading, error, loadWorkflows, deleteWorkflow } = useWorkflowStore();
  const { openWorkflowEditor: onView } = useUIStore();
  
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  async function handleDelete(id: string) {
    await deleteWorkflow(id);
    setConfirmingDelete(null);
  }

  return (
    <div className="workflows-panel">
      <div className="workflows-header">
        <h2 className="workflows-header-title">Workflows</h2>
      </div>

      <div className="workflows-list">
        {isLoading && <div className="workflows-empty">Loading workflows...</div>}
        {error && <div className="workflows-empty" style={{ color: 'var(--danger)' }}>{error}</div>}

        {!isLoading && !error && workflows.length === 0 && (
          <div className="workflows-empty">
            <div className="workflows-empty-icon">
              <Bot size={24} />
            </div>
            <p>No workflows yet.</p>
            <p style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Run an agent task, then click<br />
              <strong style={{ color: 'var(--text-secondary)' }}>"Save as Workflow"</strong> to record it.
            </p>
          </div>
        )}

        {workflows.map((wf) => (
          <WorkflowCard
            key={wf.id}
            workflow={wf}
            confirmingDelete={confirmingDelete === wf.id}
            onView={() => onView(wf.id)}
            onDelete={() => setConfirmingDelete(wf.id)}
            onConfirmDelete={() => handleDelete(wf.id)}
            onCancelDelete={() => setConfirmingDelete(null)}
          />
        ))}
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  confirmingDelete,
  onView,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: any) {
  const { role, controllerState, hostState, sendData } = useConnectionStore();
  const isConnected =
    role === 'local' ||
    hostState === 'SESSION_ACTIVE' ||
    hostState === 'AGENT_EXECUTING' ||
    hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  const { setRightPanelTab } = useUIStore();
  const isAiRecorded = workflow.source === 'ai_recorded';

  function handleRun() {
    if (!isConnected) return;
    const workflowRunId = crypto.randomUUID();
    useAgentStore.getState().startNewExecution('workflow', workflowRunId, workflow.name);

    const payload = {
      workflowRunId,
      workflowId: workflow.id,
      name: workflow.name,
      steps: workflow.steps,
    };

    if (controllerState !== 'IDLE' && sendData) {
      sendData(
        { type: 'AGENT_WORKFLOW_BATCH', version: '1.0', timestamp: Date.now(), payload },
        true
      );
    } else if (hostState !== 'IDLE' || role === 'local') {
      window.RemoteCtrlAPI?.browser.startWorkflow(payload);
    }

    setRightPanelTab('agent');
  }

  return (
    <div className="workflow-card">
      <div className="workflow-card-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isAiRecorded && (
              <span className="wf-card-ai-badge" title="Auto-recorded from AI agent run">
                <Wand2 size={10} />
              </span>
            )}
            <h3 className="workflow-card-name">{workflow.name}</h3>
          </div>
        </div>
        <div className="workflow-card-actions">
          <button className="workflow-card-action-btn" onClick={onView} title="View">
            <Eye size={14} />
          </button>
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="workflow-card-action-btn danger" onClick={onConfirmDelete}>✓</button>
              <button className="workflow-card-action-btn" onClick={onCancelDelete}>✗</button>
            </div>
          ) : (
            <button className="workflow-card-action-btn" onClick={onDelete} title="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {workflow.description && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.4 }}>
          {workflow.description.length > 80
            ? workflow.description.slice(0, 80) + '…'
            : workflow.description}
        </p>
      )}

      <div className="workflow-card-meta" style={{ display: 'flex', gap: 10 }}>
        <span>{workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}</span>
      </div>

      <button
        className="workflow-card-run-btn"
        onClick={handleRun}
        disabled={!isConnected}
      >
        <Play size={14} /> {isConnected ? 'Run Workflow' : 'Connect to Run'}
      </button>
    </div>
  );
}
