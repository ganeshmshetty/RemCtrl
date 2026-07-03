import { useState, useEffect } from 'react';
import { Save, Plus, GripVertical, Globe, MousePointerClick, ClipboardList, GitBranch } from 'lucide-react';
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
  placeholder: string;
  field: 'url' | 'instruction';
}[] = [
  {
    type: 'navigate',
    icon: <Globe size={13} />,
    label: 'Go to',
    placeholder: 'https://example.com',
    field: 'url',
  },
  {
    type: 'do',
    icon: <MousePointerClick size={13} />,
    label: 'Do',
    placeholder: 'e.g., Click the login button and type my email',
    field: 'instruction',
  },
  {
    type: 'collect',
    icon: <ClipboardList size={13} />,
    label: 'Collect',
    placeholder: 'e.g., Get all product names and prices',
    field: 'instruction',
  },
  {
    type: 'check',
    icon: <GitBranch size={13} />,
    label: 'Check',
    placeholder: 'e.g., Is there a cookie consent banner?',
    field: 'instruction',
  },
];

function defaultStep(): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    type: 'do',
    instruction: '',
    onFailure: 'stop',
  };
}

// ─── Sortable Item Component ──────────────────────────────────────────────────

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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.9 : 1,
  };

  const meta = STEP_TYPES.find(t => t.type === step.type) ?? STEP_TYPES[1];

  return (
    <div ref={setNodeRef} style={style} className="wf-editor-step">
      <div 
        className="wf-editor-step-grip" 
        {...attributes} 
        {...listeners} 
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <GripVertical size={16} />
      </div>

      <div className="wf-editor-step-body">
        {/* Header row: step number + type picker + remove */}
        <div className="wf-editor-step-header">
          <span className="wf-editor-step-label">Step {idx + 1}</span>
          <div className="wf-editor-step-type-pills">
            {STEP_TYPES.map(t => (
              <button
                key={t.type}
                className={`wf-step-type-pill${step.type === t.type ? ' active' : ''}`}
                onClick={() => changeStepType(idx, t.type)}
                title={t.label}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24, flexShrink: 0 }}
            onClick={() => removeStep(idx)}
          >
            ✕
          </button>
        </div>

        {/* Main input field */}
        <input
          className="wf-editor-step-input"
          value={meta.field === 'url' ? (step.url ?? '') : (step.instruction ?? '')}
          onChange={e =>
            updateStep(idx, meta.field === 'url'
              ? { url: e.target.value }
              : { instruction: e.target.value })
          }
          placeholder={meta.placeholder}
        />

        {/* Check step: branch selectors */}
        {step.type === 'check' && (
          <div className="wf-editor-step-branches">
            <div className="wf-editor-branch-row">
              <span className="wf-editor-branch-label wf-branch-true">✓ If true →</span>
              <select
                value={step.onTrue ?? ''}
                onChange={e => updateStep(idx, { onTrue: e.target.value || undefined })}
                className="wf-editor-branch-select"
              >
                <option value="">Continue to next step</option>
                {stepIdOptions.filter(o => o.id !== step.id).map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="wf-editor-branch-row">
              <span className="wf-editor-branch-label wf-branch-false">✗ If false →</span>
              <select
                value={step.onFalse ?? ''}
                onChange={e => updateStep(idx, { onFalse: e.target.value || undefined })}
                className="wf-editor-branch-select"
              >
                <option value="">Continue to next step</option>
                {stepIdOptions.filter(o => o.id !== step.id).map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
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
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function WorkflowEditorModal() {
  const { isWorkflowEditorOpen, closeWorkflowEditor, editingWorkflowId } = useUIStore();
  const { workflows, saveWorkflow } = useWorkflowStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (isWorkflowEditorOpen) {
      if (editingWorkflowId) {
        const wf = workflows.find(w => w.id === editingWorkflowId);
        if (wf) {
          setName(wf.name);
          setDescription(wf.description || '');
          setStartUrl(wf.startUrl || '');
          setSteps(wf.steps || []);
        }
      } else {
        setName('');
        setDescription('');
        setStartUrl('');
        setSteps([defaultStep()]);
      }
    }
  }, [isWorkflowEditorOpen, editingWorkflowId, workflows]);

  if (!isWorkflowEditorOpen) return null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSteps((items) => {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }

  function updateStep(index: number, updates: Partial<WorkflowStep>) {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    setSteps(newSteps);
  }

  function changeStepType(index: number, type: StepType) {
    const base: WorkflowStep = {
      id: steps[index].id,
      type,
      onFailure: steps[index].onFailure,
    };
    if (type === 'navigate') {
      base.url = steps[index].url || '';
    } else {
      base.instruction = steps[index].instruction || '';
    }
    if (type === 'check') {
      base.onTrue = steps[index].onTrue;
      base.onFalse = steps[index].onFalse;
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
      const validSteps = steps.filter(s =>
        s.type === 'navigate' ? !!s.url?.trim() : !!s.instruction?.trim(),
      );
      const wf = {
        id: editingWorkflowId || crypto.randomUUID(),
        name: name.trim(),
        description: description.trim(),
        startUrl: startUrl.trim(),
        steps: validSteps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveWorkflow(wf as any);
      closeWorkflowEditor();
    } finally {
      setIsSaving(false);
    }
  }

  const stepIdOptions = steps.map((s, i) => ({ id: s.id, label: `Step ${i + 1}` }));

  return (
    <div className="wf-editor-overlay">
      <div className="wf-editor-modal">
        <div className="wf-editor-header">
          <h3>{editingWorkflowId ? 'Edit Workflow' : 'Create Workflow'}</h3>
          <button className="icon-btn" onClick={closeWorkflowEditor}>✕</button>
        </div>

        <div className="wf-editor-body">
          <div className="wf-editor-field">
            <label>Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Daily Login"
              autoFocus
            />
          </div>

          <div className="wf-editor-fields-row">
            <div className="wf-editor-field">
              <label>Description (Optional)</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What does this workflow do?"
              />
            </div>
            <div className="wf-editor-field">
              <label>Start URL (Optional)</label>
              <input
                value={startUrl}
                onChange={e => setStartUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>

          <h4 className="wf-editor-steps-title">Steps</h4>

          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={steps.map(s => s.id)} 
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

          <button className="wf-editor-add-step-btn" onClick={addStep}>
            <Plus size={16} /> Add Step
          </button>
        </div>

        <div className="wf-editor-footer">
          <button className="btn btn-ghost" onClick={closeWorkflowEditor}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
          >
            <Save size={16} /> {isSaving ? 'Saving…' : 'Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}
