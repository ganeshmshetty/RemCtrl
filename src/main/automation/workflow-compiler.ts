import { randomUUID } from 'node:crypto';
import type { ExecutionTraceEntry, StepPostcondition, WorkflowStep } from '../../shared/types.js';

export interface WorkflowCompilationIssue {
  severity: 'warning' | 'error';
  traceId: string;
  message: string;
}

export interface WorkflowCompilation {
  steps: WorkflowStep[];
  issues: WorkflowCompilationIssue[];
  previewLines: string[];
}

const TRANSIENT_SELECTOR = /^\[index=\d+\]$/;

function actionDescription(entry: ExecutionTraceEntry, fallback: string): string {
  return entry.semanticDescription.trim() || fallback;
}

function urlPostcondition(url: string | undefined): StepPostcondition | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return { kind: 'url_includes', value: `${parsed.host}${parsed.pathname}` };
  } catch {
    return undefined;
  }
}

/** Converts completed browser actions into safe, replayable workflow steps. */
export function compileWorkflow(trace: ExecutionTraceEntry[]): WorkflowCompilation {
  const steps: WorkflowStep[] = [];
  const issues: WorkflowCompilationIssue[] = [];
  const previewLines: string[] = [];
  for (const entry of trace) {
    if (entry.status !== 'succeeded') {
      issues.push({ severity: 'warning', traceId: entry.id, message: `Excluded ${entry.semanticDescription}: ${entry.status}.` });
      continue;
    }
    const input = entry.input;
    const id = randomUUID();
    let step: WorkflowStep | undefined;

    if (entry.tool === 'goto' && typeof input.url === 'string') {
      const description = actionDescription(entry, `Open ${input.url}`);
      step = { id, type: 'navigate', url: input.url, description, onFailure: 'stop', postcondition: urlPostcondition(entry.urlAfter) };
    } else if (entry.tool === 'act') {
      const selector = entry.resolvedSelector || (typeof input.selector === 'string' ? input.selector : '');
      if (!selector || TRANSIENT_SELECTOR.test(selector)) {
        issues.push({ severity: 'warning', traceId: entry.id, message: `Excluded ${actionDescription(entry, 'action')}: no replayable selector.` });
      } else {
        const action = String(input.action || '');
        const description = actionDescription(entry, `${action || 'Interact with'} ${entry.targetLabel || 'page element'}`);
        if (action === 'click' || action === 'check') {
          const urlChanged = entry.urlAfter && entry.urlBefore && entry.urlAfter !== entry.urlBefore;
          step = { id, type: 'click', selector, description, onFailure: 'self_heal', postcondition: urlChanged ? urlPostcondition(entry.urlAfter) : undefined };
        } else if (action === 'fill' && typeof input.value === 'string') {
          step = { id, type: 'fill', selector, value: input.value, description, onFailure: 'self_heal', postcondition: { kind: 'field_value', selector, value: input.value } };
        } else if (action === 'select' && typeof input.value === 'string') {
          step = { id, type: 'select', selector, value: input.value, description, onFailure: 'self_heal', postcondition: { kind: 'selected_value', selector, value: input.value } };
        } else if (action === 'press') {
          step = { id, type: 'keypress', key: String(input.value || 'Enter'), description, onFailure: 'skip' };
        } else {
          issues.push({ severity: 'warning', traceId: entry.id, message: `Excluded unsupported action "${action}" from workflow.` });
        }
      }
    } else if (entry.tool === 'keys' && typeof input.key === 'string') {
      step = { id, type: 'keypress', key: input.key, description: actionDescription(entry, `Press ${input.key}`), onFailure: 'skip' };
    }

    if (step) {
      steps.push(step);
      previewLines.push(step.description || `Perform ${step.type}`);
    }
  }

  if (!steps.length) issues.push({ severity: 'error', traceId: 'workflow', message: 'No replayable successful browser actions were recorded.' });
  return { steps, issues, previewLines };
}
