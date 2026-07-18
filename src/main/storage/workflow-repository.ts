import type { LocalWorkflow } from '../../shared/types.js';
import { LocalWorkflowSchema } from '../../shared/schemas.js';
import type { JsonStore } from './automation-history-repository.js';

interface WorkflowStore {
  workflows: LocalWorkflow[];
}

export interface WorkflowRepositoryOptions {
  filePath: string;
  legacyFilePath: string;
  store: JsonStore;
  now?: () => number;
  warn?: (message: string) => void;
}

export interface WorkflowRepository {
  list(): LocalWorkflow[];
  save(workflow: LocalWorkflow): void;
  delete(workflowId: string): void;
  updateStepSelector(workflowId: string, stepId: string, selector: string): void;
}

/**
 * Deep persistence module for local workflows. It owns schema validation,
 * legacy quarantine, caching, and selector repair while callers keep a small
 * CRUD interface. The injected JsonStore is the seam for Electron files or
 * in-memory tests.
 */
export function createWorkflowRepository(options: WorkflowRepositoryOptions): WorkflowRepository {
  let cache: WorkflowStore | null = null;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));

  const load = (): WorkflowStore => {
    if (cache) return cache;
    const raw = options.store.read<unknown>(options.filePath, { workflows: [] });
    const rawWorkflows = raw !== null && typeof raw === 'object' && Array.isArray((raw as { workflows?: unknown }).workflows)
      ? (raw as { workflows: unknown[] }).workflows
      : [];
    const workflows: LocalWorkflow[] = [];
    const legacyWorkflows: unknown[] = [];

    for (const candidate of rawWorkflows) {
      const parsed = LocalWorkflowSchema.safeParse(candidate);
      if (parsed.success) {
        workflows.push(parsed.data);
      } else {
        const id = candidate !== null && typeof candidate === 'object' && 'id' in candidate
          ? (candidate as { id: unknown }).id
          : undefined;
        warn(`Quarantining unparseable workflow: ${id ?? ''} ${parsed.error.message}`);
        legacyWorkflows.push(candidate);
      }
    }

    if (legacyWorkflows.length > 0) {
      const existingLegacy = options.store.read<unknown>(options.legacyFilePath, { workflows: [] });
      const existing = existingLegacy !== null && typeof existingLegacy === 'object' && Array.isArray((existingLegacy as { workflows?: unknown }).workflows)
        ? (existingLegacy as { workflows: unknown[] }).workflows
        : [];
      const existingIds = new Set(existing
        .map((candidate) => candidate !== null && typeof candidate === 'object' && 'id' in candidate
          ? String((candidate as { id: unknown }).id)
          : '')
        .filter(Boolean));
      const newLegacy = legacyWorkflows.filter((candidate) => {
        const id = candidate !== null && typeof candidate === 'object' && 'id' in candidate
          ? String((candidate as { id: unknown }).id)
          : '';
        return id && !existingIds.has(id);
      });
      if (newLegacy.length > 0) options.store.write(options.legacyFilePath, { workflows: [...existing, ...newLegacy] });
    }

    cache = { workflows };
    return cache;
  };

  const persist = (store: WorkflowStore) => {
    options.store.write(options.filePath, store);
    cache = store;
  };

  return {
    list: () => load().workflows,
    save(workflow) {
      const parsed = LocalWorkflowSchema.parse(workflow);
      const current = load();
      const workflows = [...current.workflows];
      const index = workflows.findIndex((candidate) => candidate.id === parsed.id);
      if (index >= 0) workflows[index] = parsed;
      else workflows.push(parsed);
      persist({ ...current, workflows });
    },
    delete(workflowId) {
      const current = load();
      persist({ ...current, workflows: current.workflows.filter((workflow) => workflow.id !== workflowId) });
    },
    updateStepSelector(workflowId, stepId, selector) {
      const current = load();
      const workflows = [...current.workflows];
      const workflowIndex = workflows.findIndex((workflow) => workflow.id === workflowId);
      if (workflowIndex < 0) {
        warn(`[storage] updateWorkflowStepSelector: workflow "${workflowId}" not found — selector not persisted`);
        return;
      }
      const workflow = { ...workflows[workflowIndex] };
      const stepIndex = workflow.steps.findIndex((step) => step.id === stepId);
      if (stepIndex < 0) {
        warn(`[storage] updateWorkflowStepSelector: step "${stepId}" not found in workflow "${workflowId}" — selector not persisted`);
        return;
      }
      const step = { ...workflow.steps[stepIndex] };
      if (step.type === 'click' || step.type === 'fill' || step.type === 'select') step.selector = selector;
      workflow.steps = [...workflow.steps];
      workflow.steps[stepIndex] = step;
      workflow.updatedAt = now();
      workflows[workflowIndex] = workflow;
      persist({ ...current, workflows });
    },
  };
}
