/**
 * @file WorkflowsPanel.tsx
 * @description Saved workflow registry and the in-panel workflow preview/run view.
 * Workflow execution deliberately stays in this tab so the operator can see the
 * deterministic steps, live status, retries, and terminal result together.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Circle,
  Eye,
  Loader2,
  Play,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
import type { LocalWorkflow, WorkflowStep } from '../../shared/types';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useUIStore } from '../stores/useUIStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { describeWorkflowStep } from '../utils/workflow-preview';
import './WorkflowsPanel.css';

interface ActiveRun {
  workflow: LocalWorkflow;
  workflowRunId: string;
  started: boolean;
}

export function WorkflowsPanel() {
  const { workflows, isLoading, error, loadWorkflows, deleteWorkflow } = useWorkflowStore();
  const { openWorkflowEditor, pendingWorkflowRun, clearWorkflowRun } = useUIStore();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const visibleWorkflows = workflows.slice(0, 3);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    return window.RemoteCtrlAPI?.on.workflowCreated(() => {
      void loadWorkflows();
    });
  }, [loadWorkflows]);

  useEffect(() => {
    if (!pendingWorkflowRun) return;
    setActiveRun({ ...pendingWorkflowRun, started: true });
    clearWorkflowRun();
  }, [pendingWorkflowRun, clearWorkflowRun]);

  async function handleDelete(id: string) {
    await deleteWorkflow(id);
    setConfirmingDelete(null);
  }

  function reviewWorkflow(workflow: LocalWorkflow) {
    setActiveRun({ workflow, workflowRunId: crypto.randomUUID(), started: false });
  }

  if (activeRun) {
    return (
      <WorkflowRunView
        activeRun={activeRun}
        onBack={() => setActiveRun(null)}
        onStart={() => setActiveRun((current) => current ? { ...current, started: true } : current)}
      />
    );
  }

  return (
    <div className="workflows-panel">
      <div className="workflows-list">
        {isLoading && <div className="workflows-empty">Loading workflows...</div>}
        {error && <div className="workflows-empty workflows-error">{error}</div>}

        {!isLoading && !error && workflows.length === 0 && (
          <div className="workflows-empty">
            <div className="workflows-empty-icon"><Bot size={24} /></div>
            <p>No saved workflows yet.</p>
            <p className="workflows-empty-help">
              Describe and run a task with the agent, then save its<br />
              recorded steps as a workflow.
            </p>
          </div>
        )}

        {visibleWorkflows.map((workflow) => (
          <WorkflowCard
            key={workflow.id}
            workflow={workflow}
            confirmingDelete={confirmingDelete === workflow.id}
            onView={() => openWorkflowEditor(workflow.id)}
            onRun={() => reviewWorkflow(workflow)}
            onDelete={() => setConfirmingDelete(workflow.id)}
            onConfirmDelete={() => void handleDelete(workflow.id)}
            onCancelDelete={() => setConfirmingDelete(null)}
          />
        ))}
        {workflows.length > visibleWorkflows.length && (
          <div className="workflows-more">Showing 3 of {workflows.length} saved workflows</div>
        )}
      </div>
    </div>
  );
}

function WorkflowRunView({
  activeRun,
  onBack,
  onStart,
}: {
  activeRun: ActiveRun;
  onBack: () => void;
  onStart: () => void;
}) {
  const { role, controllerState, hostState, sendData } = useConnectionStore();
  const {
    workflowRunState,
    workflowStepStatuses,
    currentStepIndex,
  } = useAgentStore();
  const { setRightPanelTab } = useUIStore();
  const [startError, setStartError] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  const runId = activeRun.workflowRunId;
  const statuses = useMemo(
    () => workflowStepStatuses.filter((status) => status.workflowRunId === runId),
    [workflowStepStatuses, runId],
  );
  const isConnected = role === 'local'
    || ['SESSION_ACTIVE', 'AGENT_EXECUTING', 'HUMAN_TAKEOVER'].includes(hostState)
    || ['SESSION_ACTIVE', 'CONTROLLING_REMOTELY'].includes(controllerState);
  const hasStarted = activeRun.started;
  const terminal = hasStarted && (Boolean(startError) || ['completed', 'failed', 'cancelled'].includes(workflowRunState));
  const isRunning = hasStarted && !terminal && (workflowRunState === 'idle' || workflowRunState === 'running');

  async function startWorkflow() {
    if (!isConnected) return;
    setStartError(null);
    useAgentStore.getState().startNewExecution('workflow', runId, activeRun.workflow.name);
    onStart();

    const payload = {
      workflowRunId: runId,
      workflowId: activeRun.workflow.id,
      name: activeRun.workflow.name,
      steps: activeRun.workflow.steps,
    };

    try {
      if (controllerState !== 'IDLE' && sendData) {
        sendData({ type: 'AGENT_WORKFLOW_BATCH', version: '1.0', timestamp: Date.now(), payload }, true);
      } else if (hostState !== 'IDLE' || role === 'local') {
        const result = await window.RemoteCtrlAPI?.browser.startWorkflow(payload);
        if (result && !result.ok) {
          setStartError(result.error ?? 'Unable to start workflow.');
          useAgentStore.getState().clearWorkflow();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStartError(message);
      useAgentStore.getState().clearWorkflow();
    }
  }

  async function continueWithAgent() {
    setHandoffPending(true);
    try {
      if (controllerState !== 'IDLE' && sendData) {
        sendData({
          type: 'WORKFLOW_CANCEL',
          version: '1.0',
          timestamp: Date.now(),
          payload: { workflowRunId: runId },
        }, true);
      } else {
        await window.RemoteCtrlAPI?.browser.cancelWorkflow();
      }
      // Wait for the run lifecycle event before enabling the next agent
      // prompt. This avoids a race where the new prompt is rejected because
      // the deterministic runner is still unwinding its current step.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const state = useAgentStore.getState().workflowRunState;
        if (state !== 'running') break;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    } finally {
      setRightPanelTab('agent');
      window.setTimeout(() => window.dispatchEvent(new Event('remotectrl:focus-agent-input')), 0);
      setHandoffPending(false);
    }
  }

  return (
    <div className="workflows-panel workflow-run-view">
      <div className="workflow-run-header">
        <button className="workflow-run-back" onClick={onBack} title="Back to workflows">
          <ArrowLeft size={14} /> Workflows
        </button>
        <span className={`workflow-run-state ${workflowRunState}`}>
          {hasStarted ? describeRunState(workflowRunState) : 'Review steps'}
        </span>
      </div>

      <div className="workflow-run-content">
        <section className="workflow-run-summary">
          <div className="workflow-run-title-row">
            <div>
              <h2>{activeRun.workflow.name}</h2>
              {activeRun.workflow.description && <p>{activeRun.workflow.description}</p>}
            </div>
            {activeRun.workflow.source === 'ai_recorded' && (
              <span className="wf-card-ai-badge" title="Recorded from an AI agent run"><Wand2 size={11} /></span>
            )}
          </div>
          <div className="workflow-run-meta">
            <span>{activeRun.workflow.steps.length} step{activeRun.workflow.steps.length === 1 ? '' : 's'}</span>
            {hasStarted && currentStepIndex !== null && <span>Step {Math.min(currentStepIndex + 1, activeRun.workflow.steps.length)} of {activeRun.workflow.steps.length}</span>}
          </div>
          {!hasStarted && <p className="workflow-run-help">Check the deterministic steps below, then start the workflow.</p>}
          {startError && <div className="workflow-run-error"><AlertTriangle size={14} /> {startError}</div>}
        </section>

        <section className="workflow-step-list" aria-label="Workflow steps">
          {activeRun.workflow.steps.map((step, index) => {
            const status = statuses.find((item) => item.stepId === step.id);
            return <WorkflowStepRow key={step.id} step={step} index={index} state={status?.state ?? (hasStarted && index < (currentStepIndex ?? 0) ? 'completed' : 'pending')} error={status?.error} />;
          })}
        </section>

        {terminal && (
          <div className={`workflow-run-terminal ${workflowRunState}`}>
            {workflowRunState === 'completed' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <span>{terminalMessage(workflowRunState)}</span>
          </div>
        )}
      </div>

      <div className="workflow-run-footer">
        {!hasStarted ? (
          <button className="workflow-run-primary" disabled={!isConnected} onClick={() => void startWorkflow()}>
            <Play size={14} /> {isConnected ? 'Run workflow' : 'Connect to run'}
          </button>
        ) : isRunning ? (
          <button className="workflow-run-secondary" disabled={handoffPending} onClick={() => void continueWithAgent()}>
            {handoffPending ? <Loader2 className="spin" size={14} /> : <Bot size={14} />}
            {handoffPending ? 'Switching to agent…' : 'Continue with agent'}
          </button>
        ) : (
          <>
            {workflowRunState !== 'completed' && (
              <button className="workflow-run-secondary" onClick={() => void startWorkflow()} disabled={!isConnected}>
                <Play size={14} /> Run again
              </button>
            )}
            {workflowRunState !== 'completed' && workflowRunState !== 'cancelled' && (
              <button className="workflow-run-secondary" onClick={() => void continueWithAgent()} disabled={handoffPending}>
                {handoffPending ? <Loader2 className="spin" size={14} /> : <Bot size={14} />}
                Continue with agent
              </button>
            )}
            <button className="workflow-run-secondary" onClick={onBack}><ArrowLeft size={14} /> Back to workflows</button>
          </>
        )}
      </div>
    </div>
  );
}

function WorkflowStepRow({
  step,
  index,
  state,
  error,
}: {
  step: WorkflowStep;
  index: number;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
}) {
  const Icon = state === 'running' ? Loader2 : state === 'completed' ? CheckCircle2 : state === 'failed' ? XCircle : state === 'skipped' ? AlertTriangle : Circle;
  return (
    <div className={`workflow-step-row ${state}`}>
      <Icon size={15} className={state === 'running' ? 'spin' : ''} />
      <div className="workflow-step-copy">
        <span className="workflow-step-index">{index + 1}</span>
        <span className="workflow-step-description">{describeWorkflowStep(step)}</span>
        {error && <span className="workflow-step-error">{error}</span>}
      </div>
      {state !== 'pending' && <span className="workflow-step-state">{state}</span>}
    </div>
  );
}

function WorkflowCard({
  workflow,
  confirmingDelete,
  onView,
  onRun,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  workflow: LocalWorkflow;
  confirmingDelete: boolean;
  onView: () => void;
  onRun: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { role, controllerState, hostState } = useConnectionStore();
  const isConnected = role === 'local'
    || ['SESSION_ACTIVE', 'AGENT_EXECUTING', 'HUMAN_TAKEOVER'].includes(hostState)
    || ['SESSION_ACTIVE', 'CONTROLLING_REMOTELY'].includes(controllerState);
  const isAiRecorded = workflow.source === 'ai_recorded';

  return (
    <div className="workflow-card">
      <div className="workflow-card-header">
        <div className="workflow-card-heading">
          <div className="workflow-card-title-row">
            {isAiRecorded && <span className="wf-card-ai-badge" title="Auto-recorded from AI agent run"><Wand2 size={10} /></span>}
            <h3 className="workflow-card-name">{workflow.name}</h3>
          </div>
        </div>
        <div className="workflow-card-actions">
          <button className="workflow-card-action-btn" onClick={onView} title="View" aria-label={`View ${workflow.name}`}><Eye size={14} /></button>
          {confirmingDelete ? (
            <div className="workflow-card-confirm-actions">
              <button className="workflow-card-action-btn danger" onClick={onConfirmDelete} aria-label={`Delete ${workflow.name}`}>✓</button>
              <button className="workflow-card-action-btn" onClick={onCancelDelete} aria-label="Cancel delete">✗</button>
            </div>
          ) : <button className="workflow-card-action-btn" onClick={onDelete} title="Delete" aria-label={`Delete ${workflow.name}`}><Trash2 size={14} /></button>}
        </div>
      </div>

      {workflow.description && <p className="workflow-card-description">
        {workflow.description.length > 80 ? workflow.description.slice(0, 80) + '…' : workflow.description}
      </p>}
      <div className="workflow-card-meta">
        <span>{workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}</span>
      </div>
      <button className="workflow-card-run-btn" onClick={onRun} disabled={!isConnected}>
        <Play size={14} /> {isConnected ? 'Run workflow' : 'Connect to Run'}
      </button>
    </div>
  );
}

function describeRunState(state: string): string {
  if (state === 'completed') return 'Completed';
  if (state === 'failed') return 'Failed';
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'running') return 'Running';
  return 'Queued';
}

function terminalMessage(state: string): string {
  if (state === 'completed') return 'Workflow completed successfully.';
  if (state === 'cancelled') return 'Workflow stopped. You can continue with the agent from the current browser state.';
  return 'Workflow stopped after a step failed. Review the error and continue with the agent if needed.';
}
