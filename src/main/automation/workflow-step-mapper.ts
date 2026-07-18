import type { WorkflowStep } from '../../shared/types.js';

export interface RecordedToolAction {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  summary: string;
}

export interface WorkflowStepMappingOptions {
  /** Journal replay can synthesize a useful extraction instruction. */
  allowExtractFallback?: boolean;
  /** Preserve legacy journal exports that retained numbered selectors. */
  allowIndexSelector?: boolean;
}

/**
 * Converts one recorded agent tool call into a replayable workflow step.
 * Agent-loop recording and journal extraction use the same mapping rules so a
 * workflow does not change shape depending on where it was exported from.
 */
export function mapAgentToolToWorkflowStep(
  action: RecordedToolAction,
  options: WorkflowStepMappingOptions = {},
): WorkflowStep | null {
  const input = action.input;
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description
    : action.summary;
  const rawSelector = typeof input.selector === 'string' ? input.selector : '';
  const selector = rawSelector.trim() ? rawSelector : '';
  const trimmedSelector = selector.trim();
  const value = typeof input.value === 'string' ? input.value : '';

  if (action.toolName === 'goto' && typeof input.url === 'string' && input.url) {
    return { id: action.id, type: 'navigate', url: input.url, onFailure: 'stop' };
  }

  if (action.toolName === 'act' && selector && (options.allowIndexSelector || !/^\[index=\d+\]$/.test(trimmedSelector))) {
    switch (input.action) {
      case 'click': return { id: action.id, type: 'click', selector, description, onFailure: 'self_heal' };
      case 'fill': return { id: action.id, type: 'fill', selector, value, description, onFailure: 'self_heal' };
      case 'select': return { id: action.id, type: 'select', selector, value, description, onFailure: 'self_heal' };
      case 'check': return { id: action.id, type: 'click', selector, description: description || `Check ${selector}`, onFailure: 'self_heal' };
      case 'press': return { id: action.id, type: 'keypress', key: value || 'Enter', onFailure: 'skip' };
      default: return null;
    }
  }

  if (action.toolName === 'keys' && typeof input.key === 'string' && input.key) {
    return { id: action.id, type: 'keypress', key: input.key, onFailure: 'skip' };
  }

  if (action.toolName === 'extract') {
    const instruction = typeof input.instruction === 'string' && input.instruction
      ? input.instruction
      : options.allowExtractFallback
        ? `Extract text from ${selector || 'page'} (limit: ${input.limit || 8000})`
        : null;
    if (instruction) return { id: action.id, type: 'extract', instruction, onFailure: 'skip' };
  }

  return null;
}
