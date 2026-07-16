/**
 * @file storage.ts
 * @description Local persistent storage layer. Manages JSON-based configurations, serialized workflows, fetched model lists, and secure API keys within Electron's userData folder.
 * @module main/storage
 * 
 * Key Exports:
 * - App settings getters/setters (Signaling URL, Browser Profile/Mode/Headless, Custom Base URLs, Theme, and Shortcuts).
 * - API credentials validation and encryption: `hasApiKey()`, `setApiKey()`, and `getApiKey()`.
 * - Workflow orchestration: `listWorkflows()`, `saveWorkflow()`, `deleteWorkflow()`, and `updateWorkflowStepSelector()`.
 * - Models cache: `getModelsList()` and `saveModelsList()`.
 * 
 * Mechanics & Relations:
 * - Employs atomic write routines (writing to a temporary file before renaming) to protect against storage corruption.
 * - Utilizes Electron's native OS-level encryption (`safeStorage`) to secure API keys on disk.
 * - Validates schema interfaces against Zod schemas (`PersistedSettingsSchema`, `LocalWorkflowSchema`) and isolates legacy invalid schemas.
 */

import path from 'path';
import fs from 'fs';
import { app, safeStorage } from 'electron';
import { LocalWorkflow, ApiProvider, BrowserMode, AppTheme } from '../shared/types.js';
import { PersistedSettingsSchema, PersistedSettings, LocalWorkflowSchema } from '../shared/schemas.js';

import { fileURLToPath } from 'url';
import { DEFAULT_MODELS } from '../shared/default-models.js';

// ─── Paths ─────────────────────────────────────────────────────────────────────

const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const WORKFLOWS_FILE = path.join(USER_DATA, 'workflows.json');
const API_KEYS_FILE = path.join(USER_DATA, 'api-keys.json');
const MODELS_FILE = path.join(USER_DATA, 'models.json');
export const STAGEHAND_CACHE_DIR = path.join(USER_DATA, 'stagehand-cache');
export const BROWSER_PROFILE_DIR = path.join(USER_DATA, 'browser-profile');

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown) {
  ensureDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ─── Settings Storage ─────────────────────────────────────────────────────────

let _settingsCache: PersistedSettings | null = null;

export function loadSettings(): PersistedSettings {
  if (_settingsCache) return _settingsCache;
  const raw = readJson(SETTINGS_FILE, {});
  const result = PersistedSettingsSchema.safeParse(raw);
  if (result.success) {
    _settingsCache = result.data;
  } else {
    _settingsCache = PersistedSettingsSchema.parse({});
  }
  return _settingsCache;
}

export function saveSettings(settings: PersistedSettings) {
  writeJson(SETTINGS_FILE, settings);
  _settingsCache = settings;
}

export function getSignalingUrl(): string {
  return loadSettings().signalingUrl;
}

export function setSignalingUrl(url: string) {
  const s = loadSettings();
  saveSettings({ ...s, signalingUrl: url });
}

export function getPreferredProvider(): ApiProvider {
  return loadSettings().preferredProvider;
}

export function setPreferredProvider(provider: ApiProvider) {
  const s = loadSettings();
  saveSettings({ ...s, preferredProvider: provider });
}

export function getPreferredModel(): string | undefined {
  return loadSettings().preferredModel;
}

export function setPreferredModel(model: string) {
  const s = loadSettings();
  saveSettings({ ...s, preferredModel: model });
}

export function getBrowserMode(): BrowserMode {
  return loadSettings().browserMode;
}

export function setBrowserMode(mode: BrowserMode) {
  const s = loadSettings();
  saveSettings({ ...s, browserMode: mode });
}

export function getHeadlessMode(): boolean {
  return loadSettings().headlessMode;
}

export function getUseVisionCUA(): boolean {
  return loadSettings().useVisionCUA;
}

export function setUseVisionCUA(useCua: boolean) {
  const s = loadSettings();
  saveSettings({ ...s, useVisionCUA: useCua });
}

export function setHeadlessMode(headless: boolean) {
  const s = loadSettings();
  saveSettings({ ...s, headlessMode: headless });
}

export function getKeepBrowserOpenOnQuit(): boolean {
  return loadSettings().keepBrowserOpenOnQuit;
}

export function setKeepBrowserOpenOnQuit(keepOpen: boolean) {
  const s = loadSettings();
  saveSettings({ ...s, keepBrowserOpenOnQuit: keepOpen });
}

export function getBrowserProfile(): string {
  return loadSettings().browserProfile ?? 'default';
}

export function setBrowserProfile(profile: string) {
  const s = loadSettings();
  saveSettings({ ...s, browserProfile: profile });
}

export function getBrowserProfileDir(profileName?: string): string {
  const active = (profileName || getBrowserProfile()).trim();
  if (!active || active.toLowerCase() === 'default') {
    return BROWSER_PROFILE_DIR;
  }
  const safeName = active.replace(/[^a-zA-Z0-9_\- ]/g, '_');
  return path.join(USER_DATA, 'browser-profiles', safeName);
}

export function getCustomProfiles(): string[] {
  return loadSettings().customProfiles || [];
}

export function addCustomProfile(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const s = loadSettings();
  const existing = s.customProfiles || [];
  if (!existing.includes(trimmed)) {
    saveSettings({ ...s, customProfiles: [...existing, trimmed] });
  }
}

export function deleteCustomProfile(name: string) {
  const s = loadSettings();
  const existing = s.customProfiles || [];
  saveSettings({
    ...s,
    customProfiles: existing.filter(p => p !== name),
    browserProfile: s.browserProfile === name ? 'default' : s.browserProfile,
  });
}

export function getCustomBaseUrl(provider: ApiProvider): string | undefined {
  return loadSettings().customBaseUrls?.[provider];
}

export function setCustomBaseUrl(provider: ApiProvider, url: string | undefined) {
  const s = loadSettings();
  const nextUrls = { ...(s.customBaseUrls || {}) };
  if (url) {
    nextUrls[provider] = url;
  } else {
    delete nextUrls[provider];
  }
  saveSettings({ ...s, customBaseUrls: nextUrls });
}

export function getTheme(): AppTheme {
  return loadSettings().theme;
}

export function setTheme(theme: AppTheme) {
  const s = loadSettings();
  saveSettings({ ...s, theme });
}

export function isProfileInitialized(): boolean {
  return loadSettings().profileInitialized;
}

export function markProfileInitialized() {
  const s = loadSettings();
  saveSettings({ ...s, profileInitialized: true });
}

export function getGlobalShortcut(): string {
  return loadSettings().globalShortcut;
}

export function setGlobalShortcut(shortcut: string) {
  const s = loadSettings();
  saveSettings({ ...s, globalShortcut: shortcut });
}

// ─── Models Storage ─────────────────────────────────────────────────────────

let _modelsCache: Record<string, string[]> | null = null;

export function getModelsList(provider: ApiProvider): string[] {
  // 1. Try local cache
  if (!_modelsCache) {
    _modelsCache = readJson<Record<string, string[]>>(MODELS_FILE, {});
  }
  const localCache = _modelsCache;
  if (localCache[provider] && localCache[provider].length > 0) {
    return localCache[provider];
  }

  // 2. Fallback to bundled defaults
  return DEFAULT_MODELS[provider] || [];
}

export function saveModelsList(provider: ApiProvider, models: string[]) {
  // 1. Update local cache
  const currentCache = _modelsCache || readJson<Record<string, string[]>>(MODELS_FILE, {});
  const nextCache = { ...currentCache, [provider]: models };
  writeJson(MODELS_FILE, nextCache);
  _modelsCache = nextCache;

  // 2. Dev mode: Write back to src/shared/default-models.ts
  if (!app.isPackaged) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // __dirname is dist/main, so src is ../../src
      const tsPath = path.join(__dirname, '../../src/shared/default-models.ts');
      
      if (fs.existsSync(tsPath)) {
        const content = fs.readFileSync(tsPath, 'utf-8');
        const jsonMatch = content.match(/export const DEFAULT_MODELS: Record<ApiProvider, string\[\]> = (\{[\s\S]*?\});/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          parsed[provider] = models;
          const newJson = JSON.stringify(parsed, null, 2);
          const newContent = content.replace(jsonMatch[1], newJson);
          fs.writeFileSync(tsPath, newContent, 'utf-8');
        }
      }
    } catch (e) {
      console.error('Failed to auto-update default-models.ts', e);
    }
  }
}

// ─── API Key Storage (separate file, not settings.json) ───────────────────────
// Keys are stored in plain JSON for MVP. In production, use keytar (OS keychain).

interface ApiKeyStore {
  [provider: string]: string;
}

let _apiKeysCache: ApiKeyStore | null = null;

function loadApiKeys(): ApiKeyStore {
  if (!_apiKeysCache) {
    _apiKeysCache = readJson<ApiKeyStore>(API_KEYS_FILE, {});
  }
  return _apiKeysCache;
}

export function hasApiKey(provider: ApiProvider): boolean {
  const store = loadApiKeys();
  return Boolean(store[provider] && store[provider].length > 0);
}

export function setApiKey(provider: ApiProvider, value: string) {
  const store = loadApiKeys();
  let storedValue = value;
  
  if (safeStorage.isEncryptionAvailable()) {
    storedValue = `enc:${safeStorage.encryptString(value).toString('base64')}`;
  }

  const nextStore = { ...store, [provider]: storedValue };
  writeJson(API_KEYS_FILE, nextStore);
  _apiKeysCache = nextStore;
}

export function getApiKey(provider: ApiProvider): string | null {
  const store = loadApiKeys();
  const rawValue = store[provider];
  if (!rawValue) return null;

  if (rawValue.startsWith('enc:')) {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(rawValue.slice(4), 'base64');
        return safeStorage.decryptString(buffer);
      } catch (err) {
        console.error(`Failed to decrypt API key for ${provider}:`, err);
        return null;
      }
    } else {
      console.error(`Encryption not available to decrypt API key for ${provider}`);
      return null;
    }
  }

  return rawValue; // legacy unencrypted fallback
}

// ─── Workflow Storage ─────────────────────────────────────────────────────────

interface WorkflowStore {
  workflows: LocalWorkflow[];
}

let _workflowsCache: WorkflowStore | null = null;

function loadWorkflowStore(): WorkflowStore {
  if (!_workflowsCache) {
    const raw = readJson<unknown>(WORKFLOWS_FILE, { workflows: [] });
    const rawWorkflows =
      raw !== null &&
      typeof raw === 'object' &&
      Array.isArray((raw as { workflows?: unknown }).workflows)
        ? (raw as { workflows: unknown[] }).workflows
        : [];
    const workflows: LocalWorkflow[] = [];
    const legacyWorkflows: unknown[] = [];
    
    for (const w of rawWorkflows) {
      const parsed = LocalWorkflowSchema.safeParse(w);
      if (parsed.success) {
        workflows.push(parsed.data);
      } else {
        const id = w !== null && typeof w === 'object' && 'id' in w ? (w as { id: unknown }).id : undefined;
        console.warn('Quarantining unparseable workflow:', id, parsed.error?.message);
        legacyWorkflows.push(w);
      }
    }
    
    if (legacyWorkflows.length > 0) {
      const legacyFile = path.join(USER_DATA, 'workflows.legacy.json');
      const existingLegacy = readJson<unknown>(legacyFile, { workflows: [] });
      const existingLegacyWorkflows =
        existingLegacy !== null &&
        typeof existingLegacy === 'object' &&
        Array.isArray((existingLegacy as { workflows?: unknown }).workflows)
          ? (existingLegacy as { workflows: unknown[] }).workflows
          : [];
      const existingIds = new Set(
        existingLegacyWorkflows
          .map((w) => w !== null && typeof w === 'object' && 'id' in w ? String((w as { id: unknown }).id) : '')
          .filter(Boolean)
      );
      const newLegacy = legacyWorkflows.filter(
        w => {
          const id = w !== null && typeof w === 'object' && 'id' in w ? String((w as { id: unknown }).id) : '';
          return id && !existingIds.has(id);
        }
      );
      if (newLegacy.length > 0) {
        existingLegacyWorkflows.push(...newLegacy);
        writeJson(legacyFile, { workflows: existingLegacyWorkflows });
      }
    }
    
    _workflowsCache = { workflows };
  }
  return _workflowsCache;
}

export function listWorkflows(): LocalWorkflow[] {
  return loadWorkflowStore().workflows;
}

export function saveWorkflow(workflow: LocalWorkflow): void {
  // Validate before persisting
  const parsed = LocalWorkflowSchema.parse(workflow);
  const store = loadWorkflowStore();
  const nextWorkflows = [...store.workflows];
  const idx = nextWorkflows.findIndex((w) => w.id === parsed.id);
  if (idx >= 0) {
    nextWorkflows[idx] = parsed;
  } else {
    nextWorkflows.push(parsed);
  }
  const nextStore = { ...store, workflows: nextWorkflows };
  writeJson(WORKFLOWS_FILE, nextStore);
  _workflowsCache = nextStore;
}

export function deleteWorkflow(workflowId: string): void {
  const store = loadWorkflowStore();
  const nextStore = {
    ...store,
    workflows: store.workflows.filter((w) => w.id !== workflowId)
  };
  writeJson(WORKFLOWS_FILE, nextStore);
  _workflowsCache = nextStore;
}

export function updateWorkflowStepSelector(workflowId: string, stepId: string, selector: string): void {
  const store = loadWorkflowStore();
  const nextWorkflows = [...store.workflows];
  const idx = nextWorkflows.findIndex((w) => w.id === workflowId);
  if (idx < 0) {
    console.warn(`[storage] updateWorkflowStepSelector: workflow "${workflowId}" not found — selector not persisted`);
    return;
  }
  const wf = { ...nextWorkflows[idx] };
  const stepIdx = wf.steps.findIndex((s) => s.id === stepId);
  if (stepIdx < 0) {
    console.warn(`[storage] updateWorkflowStepSelector: step "${stepId}" not found in workflow "${workflowId}" — selector not persisted`);
    return;
  }
  
  const step = { ...wf.steps[stepIdx] };
  if (step.type === 'click' || step.type === 'fill' || step.type === 'select') {
    step.selector = selector;
  }
  
  wf.steps = [...wf.steps];
  wf.steps[stepIdx] = step;
  wf.updatedAt = Date.now();
  
  nextWorkflows[idx] = wf;
  const nextStore = { ...store, workflows: nextWorkflows };
  writeJson(WORKFLOWS_FILE, nextStore);
  _workflowsCache = nextStore;
}
