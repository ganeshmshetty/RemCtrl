import type { WorkflowStep } from '../../shared/types';

/** Human-readable, deterministic label used by previews and live run rows. */
export function describeWorkflowStep(step: WorkflowStep): string {
  switch (step.type) {
    case 'navigate': return step.description || `Open ${step.url}`;
    case 'click': return `Click ${step.description || step.selector}`;
    case 'fill': return `Fill ${step.description || step.selector}`;
    case 'select': return `Choose an option in ${step.description || step.selector}`;
    case 'keypress': return step.description || `Press ${step.key}`;
    case 'extract': return step.description || `Read and collect ${step.instruction}`;
    case 'check': return step.description || `Check ${step.condition}`;
    case 'wait': return step.description || `Wait for ${step.ms}ms`;
    default: return `Perform ${step.type}`;
  }
}

/** Human-readable, deterministic preview shown before any workflow executes. */
export function describeWorkflowSteps(steps: WorkflowStep[]): string {
  return steps.map((step, index) => `${index + 1}. ${describeWorkflowStep(step)}.`).join('\n');
}
