import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, ChevronDown } from 'lucide-react';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import type { LocalWorkflow, WorkflowStep, WorkflowStepAction } from '../../shared/types';

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ACTION_LABELS: Record<WorkflowStepAction, { label: string; desc: string; color: string }> = {
  act:     { label: 'Act',     desc: 'Perform an action',          color: 'var(--accent)' },
  observe: { label: 'Observe', desc: 'Observe the current state',  color: 'var(--warning)' },
  extract: { label: 'Extract', desc: 'Extract data from the page', color: 'var(--success)' },
};

function emptyWorkflow(): LocalWorkflow {
  return {
    id: generateId(),
    name: '',
    description: '',
    startUrl: '',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { saveWorkflow, loadWorkflows } = useWorkflowStore();

  const isNew = !id || id === 'new';
  const [workflow, setWorkflow] = useState<LocalWorkflow>(emptyWorkflow());
  const [errors, setErrors] = useState<{ name?: string; steps?: string }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!isNew) {
      loadWorkflows().then(() => {
        const found = useWorkflowStore.getState().workflows.find((w) => w.id === id);
        if (found) setWorkflow({ ...found });
      });
    }
  }, [id]);

  function updateField<K extends keyof LocalWorkflow>(key: K, value: LocalWorkflow[K]) {
    setWorkflow((w) => ({ ...w, [key]: value, updatedAt: Date.now() }));
  }

  function addStep() {
    const step: WorkflowStep = {
      id: generateId(),
      action: 'act',
      instruction: '',
    };
    updateField('steps', [...workflow.steps, step]);
  }

  function updateStep(stepId: string, changes: Partial<WorkflowStep>) {
    updateField(
      'steps',
      workflow.steps.map((s) => (s.id === stepId ? { ...s, ...changes } : s))
    );
  }

  function removeStep(stepId: string) {
    updateField('steps', workflow.steps.filter((s) => s.id !== stepId));
  }

  function moveStep(from: number, to: number) {
    const steps = [...workflow.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    updateField('steps', steps);
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!workflow.name.trim()) errs.name = 'Name is required';
    if (workflow.steps.some((s) => !s.instruction.trim()))
      errs.steps = 'All steps need an instruction';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setIsSaving(true);
    setErrors({});
    try {
      let finalUrl = workflow.startUrl;
      if (finalUrl && !/^https?:\/\//i.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl;
      }
      const toSave = { ...workflow, startUrl: finalUrl, updatedAt: Date.now() };
      setWorkflow(toSave);
      await saveWorkflow(toSave);
      setSavedMsg('Saved!');
      setTimeout(() => setSavedMsg(''), 2000);
      if (isNew) navigate(`/workflows/${workflow.id}`, { replace: true });
    } catch (err: any) {
      setErrors({ name: err?.message || 'Failed to save workflow' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="we-root">
      <div className="drag-region we-titlebar" />

      <div className="we-header no-drag">
        <button className="icon-btn" onClick={() => navigate('/workflows')}>
          <ArrowLeft size={16} />
        </button>
        <h1 className="we-title">{isNew ? 'New Workflow' : 'Edit Workflow'}</h1>
        {savedMsg && <span className="we-saved animate-fade-in">{savedMsg}</span>}
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={isSaving}
        >
          <Save size={13} />
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="we-body">
        {/* Workflow metadata */}
        <div className="we-meta-section">
          <div className="we-field">
            <label className="we-label">Name <span className="we-required">*</span></label>
            <input
              className={`we-input ${errors.name ? 'we-input--error' : ''}`}
              placeholder="E.g. Search and extract prices"
              value={workflow.name}
              onChange={(e) => updateField('name', e.target.value)}
              autoFocus={isNew}
            />
            {errors.name && <div className="we-error">{errors.name}</div>}
          </div>

          <div className="we-field">
            <label className="we-label">Description</label>
            <textarea
              className="we-textarea"
              placeholder="What does this workflow do?"
              value={workflow.description ?? ''}
              onChange={(e) => updateField('description', e.target.value)}
              rows={2}
            />
          </div>

          <div className="we-field">
            <label className="we-label">Start URL</label>
            <input
              className="we-input"
              type="url"
              placeholder="https://example.com (optional)"
              value={workflow.startUrl ?? ''}
              onChange={(e) => updateField('startUrl', e.target.value)}
            />
            <div className="we-hint">Browser will navigate here before step 1</div>
          </div>
        </div>

        {/* Steps */}
        <div className="we-steps-section">
          <div className="we-steps-header">
            <span className="we-steps-title">Steps</span>
            <span className="we-steps-count">{workflow.steps.length}</span>
          </div>

          {errors.steps && (
            <div className="we-error we-steps-error">{errors.steps}</div>
          )}

          <div className="we-steps-list">
            {workflow.steps.map((step, idx) => (
              <StepRow
                key={step.id}
                step={step}
                index={idx}
                total={workflow.steps.length}
                onChange={(changes) => updateStep(step.id, changes)}
                onRemove={() => removeStep(step.id)}
                onMoveUp={() => idx > 0 && moveStep(idx, idx - 1)}
                onMoveDown={() => idx < workflow.steps.length - 1 && moveStep(idx, idx + 1)}
              />
            ))}

            <button className="we-add-step-btn" onClick={addStep}>
              <Plus size={14} />
              Add Step
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .we-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
        }
        .we-titlebar { height: 28px; }
        .we-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .we-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
        }
        .we-saved {
          font-size: 12px;
          color: var(--success);
          font-weight: 500;
        }
        .we-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          gap: 28px;
          max-width: 680px;
        }
        .we-meta-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .we-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .we-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .we-required { color: var(--danger); }
        .we-input, .we-textarea {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-size: 13px;
          font-family: var(--font-sans);
          padding: 8px 12px;
          outline: none;
          transition: border-color var(--transition);
        }
        .we-input { height: 36px; }
        .we-textarea { resize: none; line-height: 1.5; }
        .we-input:focus, .we-textarea:focus { border-color: var(--accent); }
        .we-input--error { border-color: var(--danger) !important; }
        .we-hint { font-size: 11px; color: var(--text-muted); }
        .we-error { font-size: 12px; color: var(--danger); }
        .we-steps-section { display: flex; flex-direction: column; gap: 12px; }
        .we-steps-header {
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 10px;
        }
        .we-steps-title {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          flex: 1;
        }
        .we-steps-count {
          font-size: 11px;
          background: var(--bg-overlay);
          color: var(--text-secondary);
          padding: 2px 8px;
          border-radius: 99px;
          font-weight: 600;
        }
        .we-steps-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .we-steps-error { margin-bottom: 4px; }
        .we-add-step-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 16px;
          border: 1px dashed var(--border);
          border-radius: var(--radius);
          background: transparent;
          color: var(--text-muted);
          font-size: 13px;
          cursor: pointer;
          width: 100%;
          justify-content: center;
          transition: border-color var(--transition), color var(--transition);
        }
        .we-add-step-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .icon-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: var(--radius-sm);
          border: none; background: transparent; color: var(--text-muted);
          cursor: pointer; transition: color var(--transition), background var(--transition);
        }
        .icon-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 32px; padding: 0 14px; border-radius: var(--radius-sm);
          font-size: 13px; font-weight: 600; cursor: pointer; border: none;
          transition: background var(--transition), opacity var(--transition), transform var(--transition);
          white-space: nowrap;
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
      `}</style>
    </div>
  );
}

function StepRow({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: WorkflowStep;
  index: number;
  total: number;
  onChange: (changes: Partial<WorkflowStep>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const actionInfo = ACTION_LABELS[step.action];

  return (
    <div className="sr-row">
      <div className="sr-index">{index + 1}</div>

      <div className="sr-body">
        {/* Action selector */}
        <div className="sr-action-row">
          <div className="sr-select-wrap">
            <select
              className="sr-select"
              value={step.action}
              onChange={(e) => onChange({ action: e.target.value as WorkflowStepAction })}
              style={{ color: actionInfo.color }}
            >
              {(Object.keys(ACTION_LABELS) as WorkflowStepAction[]).map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a].label}</option>
              ))}
            </select>
            <ChevronDown size={12} style={{ color: 'var(--text-muted)', pointerEvents: 'none' }} />
          </div>
          <span className="sr-action-desc">{actionInfo.desc}</span>
        </div>

        {/* Instruction */}
        <textarea
          className="sr-instruction"
          placeholder="What should happen in this step?"
          value={step.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
          rows={2}
        />

        {/* Expected (optional) */}
        <input
          className="sr-expected"
          placeholder="Expected outcome (optional)"
          value={step.expected ?? ''}
          onChange={(e) => onChange({ expected: e.target.value || undefined })}
        />
      </div>

      <div className="sr-controls">
        <button className="sr-btn" onClick={onMoveUp} disabled={index === 0} title="Move up">↑</button>
        <button className="sr-btn" onClick={onMoveDown} disabled={index === total - 1} title="Move down">↓</button>
        <button className="sr-btn sr-btn-del" onClick={onRemove} title="Remove step">
          <Trash2 size={12} />
        </button>
      </div>

      <style>{`
        .sr-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 14px 16px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          transition: border-color var(--transition);
        }
        .sr-row:hover { border-color: var(--border-active); }
        .sr-index {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-overlay);
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .sr-body { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        .sr-action-row { display: flex; align-items: center; gap: 8px; }
        .sr-select-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .sr-select {
          appearance: none;
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 3px 28px 3px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          outline: none;
        }
        .sr-select-wrap svg {
          position: absolute;
          right: 8px;
        }
        .sr-action-desc { font-size: 11px; color: var(--text-muted); }
        .sr-instruction, .sr-expected {
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-size: 13px;
          font-family: var(--font-sans);
          padding: 7px 10px;
          outline: none;
          width: 100%;
          transition: border-color var(--transition);
          resize: none;
          line-height: 1.5;
        }
        .sr-instruction:focus, .sr-expected:focus { border-color: var(--accent); }
        .sr-expected { height: 30px; font-size: 12px; color: var(--text-secondary); }
        .sr-controls {
          display: flex;
          flex-direction: column;
          gap: 3px;
          flex-shrink: 0;
        }
        .sr-btn {
          width: 26px;
          height: 26px;
          border-radius: 5px;
          border: none;
          background: var(--bg-overlay);
          color: var(--text-muted);
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background var(--transition), color var(--transition);
        }
        .sr-btn:hover:not(:disabled) { background: var(--bg-elevated); color: var(--text-primary); }
        .sr-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .sr-btn-del:hover { background: rgba(239,68,68,0.15); color: var(--danger); }
      `}</style>
    </div>
  );
}
