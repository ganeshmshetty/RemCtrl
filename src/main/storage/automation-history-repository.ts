import type { AutomationRunHistoryItem } from '../../shared/types.js';

/**
 * Small persistence seam used by the automation history repository.
 *
 * Keeping file I/O outside the repository makes the history rules testable
 * without Electron or a real userData directory. The production adapter is
 * provided by storage.ts, while tests can use an in-memory map.
 */
export interface JsonStore {
  read<T>(filePath: string, fallback: T): T;
  write(filePath: string, value: unknown): void;
}

export interface AutomationHistoryRepositoryOptions {
  filePath: string;
  store: JsonStore;
  maxItems?: number;
}

export interface AutomationHistoryRepository {
  list(): AutomationRunHistoryItem[];
  save(item: AutomationRunHistoryItem): void;
  delete(id: string): void;
  clear(): void;
}

const DEFAULT_MAX_ITEMS = 30;

function isAutomationRunHistoryItem(value: unknown): value is AutomationRunHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AutomationRunHistoryItem>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && Array.isArray(item.chatHistory);
}

function sortNewestFirst(items: AutomationRunHistoryItem[]): AutomationRunHistoryItem[] {
  return [...items].sort(
    (a, b) => (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime),
  );
}

/**
 * Deep module for durable automation-run history.
 *
 * Callers only need CRUD operations; validation, ordering, de-duplication,
 * and retention are kept local to this implementation.
 */
export function createAutomationHistoryRepository(
  options: AutomationHistoryRepositoryOptions,
): AutomationHistoryRepository {
  const maxItems = Math.max(1, options.maxItems ?? DEFAULT_MAX_ITEMS);

  const list = (): AutomationRunHistoryItem[] => {
    const raw = options.store.read<unknown>(options.filePath, []);
    if (!Array.isArray(raw)) return [];
    return sortNewestFirst(raw.filter(isAutomationRunHistoryItem)).slice(0, maxItems);
  };

  const save = (item: AutomationRunHistoryItem): void => {
    const current = list().filter((existing) => existing.id !== item.id);
    options.store.write(
      options.filePath,
      sortNewestFirst([item, ...current]).slice(0, maxItems),
    );
  };

  return {
    list,
    save,
    delete(id) {
      options.store.write(
        options.filePath,
        list().filter((item) => item.id !== id),
      );
    },
    clear() {
      options.store.write(options.filePath, []);
    },
  };
}
