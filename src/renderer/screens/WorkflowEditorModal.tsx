/**
 * @file WorkflowEditorModal.tsx
 * @description Modal dialog overlay for reviewing, configuring, and saving automation workflows.
 * Supports viewing details of manual or AI-recorded sessions, providing warning labels for structurally fragile DOM selectors.
 * Connects to Zustand stores (useUIStore, useWorkflowStore) to retrieve pre-filled workflow parameters or load existing workflow metadata.
 * Saves the compiled steps structure (such as navigate, click, fill, select, keypress, wait, extract, check) locally by invoking the saveWorkflow API.
 * Key exports: WorkflowEditorModal (function component).
 */

import { useState, useEffect } from 'react';
import {
  Save, Globe, MousePointerClick, ClipboardList, GitBranch,
  Info, Wand2, ChevronRight, ChevronDown, Keyboard,
} from 'lucide-react';

import { useUIStore } from '../stores/useUIStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import type { WorkflowStep, StepType } from '../../shared/types';

// ─── Step type metadata ──────────────────────────────────────────────────────

const STEP_TYPES: {
  type: StepType;
  icon: React.ReactNode;
  label: string;
  color: string;
}[] = [
  { type: 'navigate', icon: <Globe size={12} />, label: 'Go to', color: '#3b82f6' },
  { type: 'click', icon: <MousePointerClick size={12} />, label: 'Click', color: '#10b981' },
  { type: 'fill', icon: <Wand2 size={12} />, label: 'Fill', color: '#10b981' },
  { type: 'select', icon: <ClipboardList size={12} />, label: 'Select', color: '#10b981' },
  { type: 'keypress', icon: <Keyboard size={12} />, label: 'Key', color: '#6366f1' },
  { type: 'wait', icon: <Info size={12} />, label: 'Wait', color: '#94a3b8' },
  { type: 'extract', icon: <ClipboardList size={12} />, label: 'Extract', color: '#a855f7' },
  { type: 'check', icon: <GitBranch size={12} />, label: 'Check', color: '#f59e0b' },
];

function defaultStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    type: 'click',
    selector: '',
    description: '',
    onFailure: 'stop',
  } as any;
}

// ─── Read-Only Step Row ────────────────────────────────────────────────────────

function StepRow({ step, idx }: { step: WorkflowStep; idx: number }) {
  const [expanded, setExpanded] = useState(false);

  const meta = STEP_TYPES.find((t) => t.type === step.type) ?? STEP_TYPES[1];

  let previewText = '';
  if (step.type === 'navigate') {
    previewText = step.url || 'Empty URL';
  } else if (step.type === 'click' || step.type === 'fill' || step.type === 'select') {
    previewText = step.description || step.selector || 'Empty selector';
  } else if (step.type === 'keypress') {
    previewText = step.key || 'Empty key';
  } else if (step.type === 'wait') {
    previewText = `${step.ms || 0}ms`;
  } else if (step.type === 'extract') {
    previewText = step.instruction || 'Empty instruction';
  } else if (step.type === 'check') {
    previewText = step.condition || 'Empty condition';
  }

  const sel = (step.type === 'click' || step.type === 'fill' || step.type === 'select') ? step.selector : '';
  const isFragileSelector = (step.type === 'click' || step.type === 'fill' || step.type === 'select') && 
    (sel.includes('nth-child') || sel.includes('nth-of-type') || sel.includes('[index=]') || /\[\d+\]/.test(sel));

  return (
    <div className="wf-editor-step">
      {/* Step header row */}
      <div className="wf-editor-step-header" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <div style={{ width: 20, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
          {idx + 1}
        </div>

        <div
          className="wf-step-type-badge"
          style={{
            background: `${meta.color}22`,
            color: meta.color,
            border: `1px solid ${meta.color}44`,
          }}
        >
          {meta.icon}
          <span>{meta.label}</span>
        </div>

        <div className="wf-editor-step-preview" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="wf-step-preview-text">
            {previewText.length > 55 ? previewText.slice(0, 55) + '…' : previewText}
          </span>

          {isFragileSelector && (
            <span className="wf-var-pill" style={{ background: '#fef2f2', color: '#ef4444', borderColor: '#f87171' }} title="Selector relies on layout position and may break if layout changes.">
              ⚠️ Fragile Selector
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button className="icon-btn" style={{ width: 22, height: 22 }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>
      </div>

      {/* Expandable body - Read Only */}
      {expanded && (
        <div className="wf-editor-step-body" style={{ background: 'var(--bg-secondary)', padding: '12px' }}>
          <div className="wf-editor-step-fields" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            
            {step.type === 'navigate' && (
              <div className="read-only-field"><strong>URL:</strong> {step.url}</div>
            )}
            
            {(step.type === 'click' || step.type === 'fill' || step.type === 'select') && (
              <>
                <div className="read-only-field" style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-tertiary)', padding: 6, borderRadius: 4 }}>
                  <strong>Selector:</strong> {(step as any).selector}
                </div>
                <div className="read-only-field">
                  <strong>Semantic Description:</strong> {(step as any).description}
                </div>
              </>
            )}

            {(step.type === 'fill' || step.type === 'select') && (
              <div className="read-only-field"><strong>Value:</strong> {(step as any).value}</div>
            )}

            {step.type === 'keypress' && (
              <div className="read-only-field"><strong>Key:</strong> {(step as any).key}</div>
            )}

            {step.type === 'wait' && (
              <div className="read-only-field"><strong>Wait:</strong> {(step as any).ms}ms</div>
            )}

            {step.type === 'extract' && (
              <div className="read-only-field"><strong>Instruction:</strong> {(step as any).instruction}</div>
            )}

            {step.type === 'check' && (
              <div className="read-only-field"><strong>Condition:</strong> {(step as any).condition}</div>
            )}
          </div>

          <div className="wf-editor-step-footer" style={{ marginTop: 12 }}>
            <span className="wf-editor-failure-label">On failure: <strong>{step.onFailure}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function WorkflowEditorModal() {
  const { isWorkflowEditorOpen, closeWorkflowEditor, editingWorkflowId, prefillWorkflow } =
    useUIStore();
  const { workflows, saveWorkflow } = useWorkflowStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const isAiRecorded = prefillWorkflow?.source === 'ai_recorded';
  const isEditing = !!editingWorkflowId;

  useEffect(() => {
    if (!isWorkflowEditorOpen) return;

    if (prefillWorkflow) {
      setName(prefillWorkflow.name ?? '');
      setDescription(prefillWorkflow.description ?? '');
      setSteps(prefillWorkflow.steps ?? [defaultStep()]);

    } else if (editingWorkflowId) {
      const wf = workflows.find((w) => w.id === editingWorkflowId);
      if (wf) {
        setName(wf.name);
        setDescription(wf.description || '');
        setSteps(wf.steps || []);
      }
    } else {
      setName('');
      setDescription('');
      setSteps([defaultStep()]);
    }
  }, [isWorkflowEditorOpen, editingWorkflowId, prefillWorkflow, workflows]);

  if (!isWorkflowEditorOpen) return null;

  async function handleSave() {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const existing = editingWorkflowId ? workflows.find((w) => w.id === editingWorkflowId) : undefined;
      const now = Date.now();
      const wf = {
        id: editingWorkflowId || crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        steps: steps,
        source: prefillWorkflow?.source ?? existing?.source ?? (isEditing ? undefined : ('manual' as const)),
        createdAt: now,
        updatedAt: now,
      };
      await saveWorkflow(wf as any);
      closeWorkflowEditor();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="wf-editor-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeWorkflowEditor();
      }}
    >
      <div className="wf-editor-modal wf-editor-modal-v2">
        {/* ── Header ── */}
        <div className="wf-editor-header">
          <div className="wf-editor-header-left">
            {isAiRecorded && (
              <div className="wf-ai-badge">
                <Wand2 size={12} />
                <span>AI-Recorded</span>
              </div>
            )}
            <h3 style={{ margin: 0, fontSize: 15 }}>
              {isEditing
                ? 'View Workflow'
                : 'Review & Save Recording'}
            </h3>
          </div>
          <button className="icon-btn" onClick={closeWorkflowEditor}>
            ✕
          </button>
        </div>

        {/* ── Meta fields ── */}
        <div className="wf-editor-meta">
          <div className="wf-editor-field">
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Daily Login"
              autoFocus={!isAiRecorded}
              disabled={isEditing}
            />
          </div>
        </div>

        <div style={{ padding: '0 16px 10px' }}>
          <div className="wf-editor-field">
            <label>
              Description <span style={{ opacity: 0.4 }}>(optional)</span>
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this workflow do?"
              disabled={isEditing}
            />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="wf-editor-body">
            <>
              {isAiRecorded && steps.length > 0 && (
                <div className="wf-editor-info-banner">
                  <Wand2 size={12} />
                  <span>
                    Auto-generated from your AI agent run. Name it and save.
                  </span>
                </div>
              )}

              {steps.map((step, idx) => (
                <StepRow
                  key={step.id}
                  step={step}
                  idx={idx}
                />
              ))}

              {steps.length === 0 && (
                <div className="wf-empty-steps">
                  <MousePointerClick size={22} style={{ opacity: 0.25 }} />
                  <span>No steps yet.</span>
                </div>
              )}
            </>
        </div>

        {/* ── Footer ── */}
        <div className="wf-editor-footer">
          <button className="btn btn-ghost" onClick={closeWorkflowEditor}>
            {isEditing ? 'Close' : 'Cancel'}
          </button>
          {!isEditing && (
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!name.trim() || isSaving}
            >
              <Save size={14} />{' '}
              {isSaving ? 'Saving…' : 'Save Workflow'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
