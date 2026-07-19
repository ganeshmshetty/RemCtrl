/**
 * Stable human-readable projections for agent tool events. Keeping this
 * formatting at one seam prevents the model loop and IPC log consumers from
 * each inventing slightly different descriptions for the same action.
 */
export function formatToolAction(toolName: string, input: unknown): string {
  const data = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  switch (toolName) {
    case 'goto': {
      const url = data.url || '';
      return `Navigating to ${url || 'page'}`;
    }
    case 'act': {
      const description = typeof data.description === 'string' ? data.description : '';
      if (description.trim()) return description.trim();
      const action = String(data.action || 'interact');
      const target = String(data.targetLabel || 'selected page element');
      return `${action[0].toUpperCase()}${action.slice(1)} ${target}`;
    }
    case 'observe': {
      const filter = data.filter || '';
      return filter ? `Observing: ${filter}` : 'Observing page elements';
    }
    case 'extract': {
      const selector = data.selector || '';
      return selector ? `Extracting from ${selector}` : 'Extracting page content';
    }
    case 'type': return 'Type into the focused field';
    case 'getPageUrl': return 'Getting current page URL';
    case 'inspectScreenshot': return 'Inspecting current page visually';
    case 'keys': return `Pressing key: ${data.key || ''}`;
    case 'scroll': return `Scrolling ${data.direction || ''} ${data.pixels || 500}px`;
    case 'done': return 'Task completed';
    case 'notifyUser': return `Update: ${data.message || ''}`;
    case 'runActionSequence': {
      const count = Array.isArray(data.actions) ? data.actions.length : 0;
      return `Executing sequence of ${count} actions`;
    }
    default: return `Running ${toolName}`;
  }
}
