import { useState, useEffect } from 'react';
import {
  Save, Plus, GripVertical, Globe, MousePointerClick, ClipboardList, GitBranch,
  Variable, Trash2, Info, Wand2, ChevronRight, ChevronDown,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  {
    type: 'navigate',
    icon: <Globe size={12} />,
    label: 'Go to',
    color: '#3b82f6',
  },
  {
    type: 'click',
    icon: <MousePointerClick size={12} />,
    label: 'Click',
    color: '#10b981',
  },
  {
    type: 'fill',
    icon: <Wand2 size={12} />,
    label: 'Fill',
    color: '#10b981',
  },
  {
    type: 'select',
    icon: <ClipboardList size={12} />,
    label: 'Select',
    color: '#10b981',
  },
  {
    type: 'keypress',
    icon: <Variable size={12} />,
    label: 'Key',
    color: '#6366f1',
  },
  {
    type: 'wait',
    icon: <Info size={12} />,
    label: 'Wait',
    color: '#94a3b8',
  },
  {
    type: 'extract',
    icon: <ClipboardList size={12} />,
    label: 'Extract',
    color: '#a855f7',
  },
  {
    type: 'check',
    icon: <GitBranch size={12} />,
    label: 'Check',
    color: '#f59e0b',
  },
];

function defaultStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    type: 'click',
    selector: '',
    description: '',
    onFailure: 'stop',
  } as any; // Typecast because of discriminated union
}

export type WorkflowStepFields = Partial<{
  type: StepType;
  url: string;
  selector: string;
  value: string;
  key: string;
  ms: number;
  instruction: string;
  variableName: string;
  condition: string;
  onTrue: string;
  onFalse: string;
  description: string;
  onFailure: 'stop' | 'skip' | 'retry' | 'self_heal';
}>;

/** Extract {{variable_name}} tokens from a string */
function extractVarTokens(text: string): string[] {
  const matches = text.match(/\{\{([^}]+)\}\}/g) ?? [];
  return matches.map((m) => m.slice(2, -2).trim()).filter(Boolean);
}

// ─── Variable Panel ──────────────────────────────────────────────────────────

function VariablePanel({
  variables,
  usedVars,
  onChange,
}: {
  variables: Record<string, string>;
  usedVars: Set<string>;
  onChange: (vars: Record<string, string>) => void;
}) {
  const allVars = Array.from(new Set([...Object.keys(variables), ...Array.from(usedVars)]));

  function updateVar(key: string, value: string) {
    onChange({ ...variables, [key]: value });
  }

  function removeVar(key: string) {
    const next = { ...variables };
    delete next[key];
    onChange(next);
  }

  function addVar() {
    let i = Object.keys(variables).length + 1;
    let name = `var_${i}`;
    while (name in variables) {
      i++;
      name = `var_${i}`;
    }
    onChange({ ...variables, [name]: '' });
  }

  if (allVars.length === 0) {
    return (
      <div className="wf-var-empty">
        <Info size={13} style={{ opacity: 0.5 }} />
        <span>Use <code>{'{{variable_name}}'}</code> in any step to add parameters here.</span>
      </div>
    );
  }

  return (
    <div className="wf-var-list">
      {allVars.map((key) => {
        const isUsed = usedVars.has(key);
        return (
          <div key={key} className={`wf-var-row ${isUsed ? 'used' : 'unused'}`}>
            <div className="wf-var-name">
              <Variable size={11} style={{ opacity: 0.6, flexShrink: 0 }} />
              <span className="wf-var-token">{`{{${key}}}`}</span>
              {!isUsed && <span className="wf-var-badge unused">unused</span>}
            </div>
            <input
              className="wf-var-input"
              value={variables[key] ?? ''}
              onChange={(e) => updateVar(key, e.target.value)}
              placeholder="Default value…"
            />
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              onClick={() => removeVar(key)}
              title="Remove variable"
            >
              <Trash2 size={11} />
            </button>
          </div>
        );
      })}
      <button className="wf-var-add-btn" onClick={addVar}>
        <Plus size={12} /> Add variable
      </button>
    </div>
  );
}

// ─── Sortable Step Row ────────────────────────────────────────────────────────

function SortableStepRow({
  step,
  idx,
  stepIdOptions,
  changeStepType,
  removeStep,
  updateStep,
}: {
  step: WorkflowStep;
  idx: number;
  stepIdOptions: { id: string; label: string }[];
  changeStepType: (index: number, type: StepType) => void;
  removeStep: (index: number) => void;
  updateStep: (index: number, updates: Partial<WorkflowStep>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
  });
  const [expanded, setExpanded] = useState(true);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.85 : 1,
  };

  const meta = STEP_TYPES.find((t) => t.type === step.type) ?? STEP_TYPES[1];
  
  // Extract all string values from the step for the preview & variable check
  const allText = Object.values(step).filter(v => typeof v === 'string').join(' ');
  const hasVars = /\{\{[^}]+\}\}/.test(allText);

  let previewText = '';
  if (step.type === 'navigate') previewText = step.url || 'Empty URL';
  else if (step.type === 'click' || step.type === 'fill' || step.type === 'select') previewText = (step as any).description || (step as any).selector || 'Empty selector';
  else if (step.type === 'keypress') previewText = (step as any).key || 'Empty key';
  else if (step.type === 'wait') previewText = `${(step as any).ms || 0}ms`;
  else if (step.type === 'extract') previewText = (step as any).instruction || 'Empty instruction';
  else if (step.type === 'check') previewText = (step as any).condition || 'Empty condition';

  const isFragileSelector = (step.type === 'click' || step.type === 'fill' || step.type === 'select') && 
    ((step as any).selector?.includes('nth-child') || (step as any).selector?.includes('nth-of-type') || (step as any).selector?.includes('[index=]'));

  return (
    <div ref={setNodeRef} style={style} className={`wf-editor-step ${isDragging ? 'dragging' : ''}`}>
      {/* Step header row */}
      <div className="wf-editor-step-header">
        <div
          className="wf-editor-step-grip"
          {...attributes}
          {...listeners}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <GripVertical size={15} />
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

        <div
          className="wf-editor-step-preview"
          onClick={() => setExpanded(!expanded)}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span className="wf-step-preview-text">
            {previewText.length > 55 ? previewText.slice(0, 55) + '…' : previewText}
          </span>
          {hasVars && <span className="wf-var-pill">has variables</span>}
          {isFragileSelector && (
            <span className="wf-var-pill" style={{ background: '#fef2f2', color: '#ef4444', borderColor: '#f87171' }} title="Selector relies on layout position and may break if layout changes.">
              ⚠️ Fragile Selector
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22, color: 'var(--danger)' }}
            onClick={() => removeStep(idx)}
            title="Remove step"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="wf-editor-step-body">
          {/* Type pills */}
          <div className="wf-editor-step-type-pills">
            {STEP_TYPES.map((t) => (
              <button
                key={t.type}
                className={`wf-step-type-pill${step.type === t.type ? ' active' : ''}`}
                style={
                  step.type === t.type
                    ? { background: `${t.color}22`, color: t.color, borderColor: `${t.color}55` }
                    : {}
                }
                onClick={() => changeStepType(idx, t.type)}
                title={t.label}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Main input fields based on type */}
          <div className="wf-editor-step-fields" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {step.type === 'navigate' && (
              <input
                className="wf-editor-step-input"
                value={step.url ?? ''}
                onChange={(e) => updateStep(idx, { url: e.target.value })}
                placeholder="https://example.com or {{url}}"
              />
            )}
            
            {(step.type === 'click' || step.type === 'fill' || step.type === 'select') && (
              <>
                <input
                  className="wf-editor-step-input"
                  value={(step as any).selector ?? ''}
                  onChange={(e) => updateStep(idx, { selector: e.target.value })}
                  placeholder="CSS Selector (e.g. #submit-btn)"
                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                />
                <input
                  className="wf-editor-step-input"
                  value={(step as any).description ?? ''}
                  onChange={(e) => updateStep(idx, { description: e.target.value })}
                  placeholder="Semantic description for AI self-healing (e.g. The submit button)"
                />
              </>
            )}

            {(step.type === 'fill' || step.type === 'select') && (
              <input
                className="wf-editor-step-input"
                value={(step as any).value ?? ''}
                onChange={(e) => updateStep(idx, { value: e.target.value })}
                placeholder={step.type === 'fill' ? 'Value to fill or {{variable}}' : 'Value to select'}
              />
            )}

            {step.type === 'keypress' && (
              <input
                className="wf-editor-step-input"
                value={(step as any).key ?? ''}
                onChange={(e) => updateStep(idx, { key: e.target.value })}
                placeholder="Key (e.g. Enter, Escape, Tab)"
              />
            )}

            {step.type === 'wait' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  className="wf-editor-step-input"
                  type="number"
                  value={(step as any).ms ?? 0}
                  onChange={(e) => updateStep(idx, { ms: parseInt(e.target.value, 10) || 0 })}
                  placeholder="Milliseconds"
                  style={{ width: '120px' }}
                />
                <span style={{ fontSize: 12, opacity: 0.6 }}>ms</span>
              </div>
            )}

            {step.type === 'extract' && (
              <>
                <textarea
                  className="wf-editor-step-textarea"
                  value={(step as any).instruction ?? ''}
                  onChange={(e) => updateStep(idx, { instruction: e.target.value })}
                  placeholder="What data to extract?"
                  rows={2}
                />
                <input
                  className="wf-editor-step-input"
                  value={(step as any).variableName ?? ''}
                  onChange={(e) => updateStep(idx, { variableName: e.target.value })}
                  placeholder="Store in variable (e.g. extracted_price)"
                />
              </>
            )}

            {step.type === 'check' && (
              <textarea
                className="wf-editor-step-textarea"
                value={(step as any).condition ?? ''}
                onChange={(e) => updateStep(idx, { condition: e.target.value })}
                placeholder="Text or label to verify (e.g. 'Success')"
                rows={1}
              />
            )}
          </div>

          {/* Check step: branch selectors */}
          {step.type === 'check' && (
            <div className="wf-editor-step-branches">
              <div className="wf-editor-branch-row">
                <span className="wf-editor-branch-label wf-branch-true">✓ If true →</span>
                <select
                  value={step.onTrue ?? ''}
                  onChange={(e) => updateStep(idx, { onTrue: e.target.value || undefined })}
                  className="wf-editor-branch-select"
                >
                  <option value="">Continue to next step</option>
                  {stepIdOptions
                    .filter((o) => o.id !== step.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="wf-editor-branch-row">
                <span className="wf-editor-branch-label wf-branch-false">✗ If false →</span>
                <select
                  value={step.onFalse ?? ''}
                  onChange={(e) => updateStep(idx, { onFalse: e.target.value || undefined })}
                  className="wf-editor-branch-select"
                >
                  <option value="">Continue to next step</option>
                  {stepIdOptions
                    .filter((o) => o.id !== step.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {/* onFailure toggle */}
          <div className="wf-editor-step-footer">
            <span className="wf-editor-failure-label">On failure:</span>
            <div className="wf-editor-failure-pills">
              <button
                className={`wf-failure-pill${step.onFailure === 'stop' ? ' active danger' : ''}`}
                onClick={() => updateStep(idx, { onFailure: 'stop' })}
              >
                Stop
              </button>
              <button
                className={`wf-failure-pill${step.onFailure === 'skip' ? ' active' : ''}`}
                onClick={() => updateStep(idx, { onFailure: 'skip' })}
              >
                Skip
              </button>
              <button
                className={`wf-failure-pill${step.onFailure === 'retry' ? ' active warning' : ''}`}
                onClick={() => updateStep(idx, { onFailure: 'retry' })}
              >
                Retry
              </button>
            </div>
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
  const [startUrl, setStartUrl] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'steps' | 'variables'>('steps');

  const isAiRecorded = prefillWorkflow?.source === 'ai_recorded';
  const isEditing = !!editingWorkflowId;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!isWorkflowEditorOpen) return;

    if (prefillWorkflow) {
      setName(prefillWorkflow.name ?? '');
      setDescription(prefillWorkflow.description ?? '');
      setStartUrl(prefillWorkflow.startUrl ?? '');
      setSteps(prefillWorkflow.steps ?? [defaultStep()]);
      setVariables(prefillWorkflow.variables ?? {});
      setActiveTab(
        prefillWorkflow.variables && Object.keys(prefillWorkflow.variables).length > 0
          ? 'variables'
          : 'steps'
      );
    } else if (editingWorkflowId) {
      const wf = workflows.find((w) => w.id === editingWorkflowId);
      if (wf) {
        setName(wf.name);
        setDescription(wf.description || '');
        setStartUrl(wf.startUrl || '');
        setSteps(wf.steps || []);
        setVariables(wf.variables ?? {});
        setActiveTab('steps');
      }
    } else {
      setName('');
      setDescription('');
      setStartUrl('');
      setSteps([defaultStep()]);
      setVariables({});
      setActiveTab('steps');
    }
  }, [isWorkflowEditorOpen, editingWorkflowId, prefillWorkflow, workflows]);

  if (!isWorkflowEditorOpen) return null;

  // Compute which variable names are actually referenced in steps
  const usedVarNames = new Set<string>();
  for (const step of steps) {
    const text = Object.values(step).filter(v => typeof v === 'string').join(' ');
    for (const v of extractVarTokens(text)) usedVarNames.add(v);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSteps((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  function updateStep(index: number, updates: WorkflowStepFields) {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates } as WorkflowStep;
    setSteps(newSteps);

    // Auto-discover new {{vars}} typed into steps
    const updatedText = Object.values(updates).filter(v => typeof v === 'string').join(' ');
    if (updatedText) {
      const newVars = extractVarTokens(updatedText);
      const updated = { ...variables };
      let changed = false;
      for (const v of newVars) {
        if (!(v in updated)) {
          updated[v] = '';
          changed = true;
        }
      }
      if (changed) setVariables(updated);
    }
  }

  function changeStepType(index: number, type: StepType) {
    const old = steps[index] as any;
    let base: WorkflowStep;
    
    switch (type) {
      case 'navigate':
        base = { id: old.id, onFailure: old.onFailure, type: 'navigate', url: old.url || '' };
        break;
      case 'click':
        base = { id: old.id, onFailure: old.onFailure, type: 'click', selector: old.selector || '', description: old.description || '' };
        break;
      case 'fill':
        base = { id: old.id, onFailure: old.onFailure, type: 'fill', selector: old.selector || '', value: old.value || '', description: old.description || '' };
        break;
      case 'select':
        base = { id: old.id, onFailure: old.onFailure, type: 'select', selector: old.selector || '', value: old.value || '', description: old.description || '' };
        break;
      case 'keypress':
        base = { id: old.id, onFailure: old.onFailure, type: 'keypress', key: old.key || '' };
        break;
      case 'wait':
        base = { id: old.id, onFailure: old.onFailure, type: 'wait', ms: old.ms || 1000 };
        break;
      case 'extract':
        base = { id: old.id, onFailure: old.onFailure, type: 'extract', instruction: old.instruction || '', variableName: old.variableName || '' };
        break;
      case 'check':
        base = { id: old.id, onFailure: old.onFailure, type: 'check', condition: old.condition || '', onTrue: old.onTrue, onFalse: old.onFalse };
        break;
      default:
        throw new Error("unsupported type");
    }

    const newSteps = [...steps];
    newSteps[index] = base;
    setSteps(newSteps);
  }

  function addStep() {
    setSteps([...steps, defaultStep()]);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const validSteps = steps
        .filter((s) => {
          if (s.type === 'navigate') return !!s.url?.trim();
          if (s.type === 'click' || s.type === 'fill' || s.type === 'select') return !!s.selector?.trim();
          if (s.type === 'keypress') return !!s.key?.trim();
          if (s.type === 'wait') return !!s.ms;
          if (s.type === 'extract') return !!s.instruction?.trim();
          if (s.type === 'check') return !!s.condition?.trim();
          return false;
        })
        .map((s) => ({ ...s }));
      const validStepIds = new Set(validSteps.map((s) => s.id));
      for (const step of validSteps) {
        if (step.type === 'check') {
          if (step.onTrue && !validStepIds.has(step.onTrue)) delete step.onTrue;
          if (step.onFalse && !validStepIds.has(step.onFalse)) delete step.onFalse;
        }
      }
      const existing = editingWorkflowId ? workflows.find((w) => w.id === editingWorkflowId) : undefined;
      const now = Date.now();
      const wf = {
        id: editingWorkflowId || crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        startUrl: startUrl.trim(),
        steps: validSteps,
        variables,
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

  const stepIdOptions = steps.map((s, i) => ({ id: s.id, label: `Step ${i + 1}` }));
  const varCount = Object.keys(variables).length;

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
                ? 'Edit Workflow'
                : isAiRecorded
                ? 'Review & Save Recording'
                : 'New Workflow'}
            </h3>
          </div>
          <button className="icon-btn" onClick={closeWorkflowEditor}>
            ✕
          </button>
        </div>

        {/* ── Meta fields ── */}
        <div className="wf-editor-meta">
          <div className="wf-editor-field" style={{ flex: 2 }}>
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Daily Login"
              autoFocus={!isAiRecorded}
            />
          </div>
          <div className="wf-editor-field" style={{ flex: 1 }}>
            <label>
              Start URL <span style={{ opacity: 0.4 }}>(optional)</span>
            </label>
            <input
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              placeholder="https://…"
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
            />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="wf-editor-tabs">
          <button
            className={`wf-editor-tab ${activeTab === 'steps' ? 'active' : ''}`}
            onClick={() => setActiveTab('steps')}
          >
            Steps
            <span className="wf-tab-count">{steps.length}</span>
          </button>
          <button
            className={`wf-editor-tab ${activeTab === 'variables' ? 'active' : ''}`}
            onClick={() => setActiveTab('variables')}
          >
            <Variable size={12} />
            Variables
            {varCount > 0 && <span className="wf-tab-count">{varCount}</span>}
          </button>
        </div>

        {/* ── Body ── */}
        <div className="wf-editor-body">
          {activeTab === 'steps' ? (
            <>
              {isAiRecorded && steps.length > 0 && (
                <div className="wf-editor-info-banner">
                  <Wand2 size={12} />
                  <span>
                    Auto-generated from your AI agent run. Edit steps, rename variables in the
                    Variables tab, then save.
                  </span>
                </div>
              )}

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={steps.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {steps.map((step, idx) => (
                    <SortableStepRow
                      key={step.id}
                      step={step}
                      idx={idx}
                      stepIdOptions={stepIdOptions}
                      changeStepType={changeStepType}
                      removeStep={removeStep}
                      updateStep={updateStep}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {steps.length === 0 && (
                <div className="wf-empty-steps">
                  <MousePointerClick size={22} style={{ opacity: 0.25 }} />
                  <span>No steps yet. Add one or run an agent task to auto-record steps.</span>
                </div>
              )}

              <button className="wf-editor-add-step-btn" onClick={addStep}>
                <Plus size={14} /> Add Step
              </button>
            </>
          ) : (
            <div style={{ padding: '4px 0' }}>
              <div className="wf-var-section-header">
                <Variable size={13} />
                <span>Template Variables</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  Referenced with{' '}
                  <code style={{ fontSize: 10, background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3 }}>
                    {'{{variable_name}}'}
                  </code>{' '}
                  in step instructions
                </span>
              </div>
              <VariablePanel
                variables={variables}
                usedVars={usedVarNames}
                onChange={setVariables}
              />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="wf-editor-footer">
          <button className="btn btn-ghost" onClick={closeWorkflowEditor}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
          >
            <Save size={14} />{' '}
            {isSaving ? 'Saving…' : isEditing ? 'Update Workflow' : 'Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}
