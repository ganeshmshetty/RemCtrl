/**
 * @file useWorkflowStore.ts
 * @description Zustand stores for managing custom workflows and application settings.
 * Exports the `useWorkflowStore` hook for CRUD operations on local user workflows, and
 * the `useSettingsStore` hook for system settings, API keys, browser profiles, and theme preferences.
 * Internally coordinates with the main process using IPC via the `window.RemoteCtrlAPI` preload bridge.
 * Integrates with Settings and Workflow interfaces in the UI to persist and update settings.
 */

import { create } from 'zustand';
import type { LocalWorkflow, ApiProvider, AppTheme, LocalWhisperSetupState, SpeechInputMode } from '../../shared/types';

interface WorkflowState {
  workflows: LocalWorkflow[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setWorkflows: (workflows: LocalWorkflow[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Async thunks (call window.RemoteCtrlAPI under the hood)
  loadWorkflows: () => Promise<void>;
  saveWorkflow: (workflow: LocalWorkflow) => Promise<void>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  isLoading: false,
  error: null,

  setWorkflows: (workflows) => set({ workflows }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  loadWorkflows: async () => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await window.RemoteCtrlAPI.workflows.list();
      set({ workflows, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  saveWorkflow: async (workflow) => {
    try {
      await window.RemoteCtrlAPI.workflows.save(workflow);
      await get().loadWorkflows();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  deleteWorkflow: async (workflowId) => {
    try {
      await window.RemoteCtrlAPI.workflows.delete(workflowId);
      set((state) => ({
        workflows: state.workflows.filter((w) => w.id !== workflowId),
      }));
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));

// ─── Settings Store ───────────────────────────────────────────────────────────

interface SettingsState {
  signalingUrl: string;
  preferredProvider: ApiProvider;
  preferredModel?: string;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  hasGroqKey: boolean;
  hasDeepseekKey: boolean;
  hasNebiusKey: boolean;
  hasOpenRouterKey: boolean;
  hasVertexKey: boolean;
  headlessMode: boolean;
  keepBrowserOpenOnQuit: boolean;
  browserProfile: string;
  customProfiles: string[];
  theme: AppTheme;
  isLoading: boolean;

  // Actions
  loadSettings: () => Promise<void>;
  setSignalingUrl: (url: string) => Promise<void>;
  setPreferredProvider: (provider: ApiProvider) => Promise<void>;
  setPreferredModel: (model: string) => Promise<void>;
  setApiKey: (provider: ApiProvider, value: string) => Promise<void>;
  setHeadlessMode: (headless: boolean) => Promise<void>;
  setKeepBrowserOpenOnQuit: (keepOpen: boolean) => Promise<void>;
  setBrowserProfile: (profile: string) => Promise<void>;
  addCustomProfile: (name: string) => Promise<void>;
  deleteCustomProfile: (name: string) => Promise<void>;
  setTheme: (theme: AppTheme) => Promise<void>;
  useVisionCUA: boolean;
  setUseVisionCUA: (useCua: boolean) => Promise<void>;
  microphoneAudioEnabled: boolean;
  whisperSetup: LocalWhisperSetupState;
  setWhisperSetup: (setup: LocalWhisperSetupState) => void;
  downloadWhisperModel: () => Promise<void>;
  cancelWhisperDownload: () => Promise<void>;
  retryWhisperDownload: () => Promise<void>;
  speechInputMode: SpeechInputMode;
  setMicrophoneAudioEnabled: (enabled: boolean) => Promise<void>;
  setSpeechInputMode: (mode: SpeechInputMode) => Promise<void>;
  isSettingsOpen: boolean;
  setSettingsOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  signalingUrl: 'http://localhost:3001',
  preferredProvider: 'openai',
  preferredModel: undefined,
  hasOpenAIKey: false,
  hasAnthropicKey: false,
  hasGeminiKey: false,
  hasGroqKey: false,
  hasDeepseekKey: false,
  hasNebiusKey: false,
  hasOpenRouterKey: false,
  hasVertexKey: false,
  headlessMode: true,
  keepBrowserOpenOnQuit: false,
  browserProfile: 'default',
  customProfiles: [],
  theme: 'system',
  useVisionCUA: true,
  microphoneAudioEnabled: false,
  whisperSetup: {
    model: { status: 'not_installed', fileName: 'whisper-tiny.en', sizeBytes: 75 * 1024 * 1024, bytesDownloaded: 0, progress: null, verified: false },
    runtime: { available: true, reason: 'onnx-local', message: 'Local ONNX Whisper transcription is ready on this device.' },
  },
  speechInputMode: 'push_to_talk',
  isLoading: false,
  isSettingsOpen: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const [signalingUrl, preferredProvider, preferredModel, hasOpenAIKey, hasAnthropicKey, hasGeminiKey, hasGroqKey, hasDeepseekKey, hasNebiusKey, hasOpenRouterKey, hasVertexKey, headlessMode, keepBrowserOpenOnQuit, browserProfile, customProfiles, useVisionCUA, theme, microphoneAudioEnabled, speechInputMode, whisperSetup] =
        await Promise.all([
          window.RemoteCtrlAPI.settings.getSignalingUrl(),
          window.RemoteCtrlAPI.settings.getPreferredProvider(),
          window.RemoteCtrlAPI.settings.getPreferredModel(),
          window.RemoteCtrlAPI.settings.hasApiKey('openai'),
          window.RemoteCtrlAPI.settings.hasApiKey('anthropic'),
          window.RemoteCtrlAPI.settings.hasApiKey('gemini'),
          window.RemoteCtrlAPI.settings.hasApiKey('groq'),
          window.RemoteCtrlAPI.settings.hasApiKey('deepseek'),
          window.RemoteCtrlAPI.settings.hasApiKey('nebius'),
          window.RemoteCtrlAPI.settings.hasApiKey('openrouter'),
          window.RemoteCtrlAPI.settings.hasApiKey('vertex'),
          window.RemoteCtrlAPI.settings.getHeadlessMode(),
          window.RemoteCtrlAPI.settings.getKeepBrowserOpenOnQuit(),
          window.RemoteCtrlAPI.settings.getBrowserProfile(),
          window.RemoteCtrlAPI.settings.getCustomProfiles(),
          window.RemoteCtrlAPI.settings.getUseVisionCUA(),
          window.RemoteCtrlAPI.settings.getTheme(),
          window.RemoteCtrlAPI.settings.getMicrophoneAudioEnabled(),
          window.RemoteCtrlAPI.settings.getSpeechInputMode(),
          window.RemoteCtrlAPI.speech.getSetupState(),
        ]);
      set({ signalingUrl, preferredProvider, preferredModel, hasOpenAIKey, hasAnthropicKey, hasGeminiKey, hasGroqKey, hasDeepseekKey, hasNebiusKey, hasOpenRouterKey, hasVertexKey, headlessMode, keepBrowserOpenOnQuit, browserProfile, customProfiles, useVisionCUA, theme, microphoneAudioEnabled, speechInputMode, whisperSetup, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setSignalingUrl: async (url) => {
    await window.RemoteCtrlAPI.settings.setSignalingUrl(url);
    set({ signalingUrl: url });
  },

  setPreferredProvider: async (provider) => {
    await window.RemoteCtrlAPI.settings.setPreferredProvider(provider);
    set({ preferredProvider: provider });
  },

  setPreferredModel: async (model) => {
    await window.RemoteCtrlAPI.settings.setPreferredModel(model);
    set({ preferredModel: model });
  },

  setApiKey: async (provider, value) => {
    await window.RemoteCtrlAPI.settings.setApiKey(provider, value);
    set(() => {
      const updates: Partial<SettingsState> = {};
      if (provider === 'openai') updates.hasOpenAIKey = !!value;
      if (provider === 'anthropic') updates.hasAnthropicKey = !!value;
      if (provider === 'gemini') updates.hasGeminiKey = !!value;
      if (provider === 'groq') updates.hasGroqKey = !!value;
      if (provider === 'deepseek') updates.hasDeepseekKey = !!value;
      if (provider === 'nebius') updates.hasNebiusKey = !!value;
      if (provider === 'openrouter') updates.hasOpenRouterKey = !!value;
      if (provider === 'vertex') updates.hasVertexKey = !!value;
      return updates;
    });
  },

  setHeadlessMode: async (headless) => {
    await window.RemoteCtrlAPI.settings.setHeadlessMode(headless);
    set({ headlessMode: headless });
  },

  setKeepBrowserOpenOnQuit: async (keepOpen) => {
    await window.RemoteCtrlAPI.settings.setKeepBrowserOpenOnQuit(keepOpen);
    set({ keepBrowserOpenOnQuit: keepOpen });
  },

  setBrowserProfile: async (profile) => {
    await window.RemoteCtrlAPI.settings.setBrowserProfile(profile);
    set({ browserProfile: profile });
  },

  addCustomProfile: async (name) => {
    await window.RemoteCtrlAPI.settings.addCustomProfile(name);
    const customProfiles = await window.RemoteCtrlAPI.settings.getCustomProfiles();
    set({ customProfiles });
  },

  deleteCustomProfile: async (name) => {
    await window.RemoteCtrlAPI.settings.deleteCustomProfile(name);
    const customProfiles = await window.RemoteCtrlAPI.settings.getCustomProfiles();
    const currentProfile = await window.RemoteCtrlAPI.settings.getBrowserProfile();
    set({ customProfiles, browserProfile: currentProfile });
  },

  setTheme: async (theme) => {
    await window.RemoteCtrlAPI.settings.setTheme(theme);
    set({ theme });
  },

  setUseVisionCUA: async (useCua) => {
    await window.RemoteCtrlAPI.settings.setUseVisionCUA(useCua);
    set({ useVisionCUA: useCua });
  },

  setWhisperSetup: (whisperSetup) => set({ whisperSetup }),

  downloadWhisperModel: async () => {
    const whisperSetup = await window.RemoteCtrlAPI.speech.downloadModel();
    set({ whisperSetup });
  },

  cancelWhisperDownload: async () => {
    const whisperSetup = await window.RemoteCtrlAPI.speech.cancelDownload();
    set({ whisperSetup });
  },

  retryWhisperDownload: async () => {
    const whisperSetup = await window.RemoteCtrlAPI.speech.retryDownload();
    set({ whisperSetup });
  },

  setMicrophoneAudioEnabled: async (enabled) => {
    await window.RemoteCtrlAPI.settings.setMicrophoneAudioEnabled(enabled);
    set({ microphoneAudioEnabled: enabled });
  },

  setSpeechInputMode: async (mode) => {
    await window.RemoteCtrlAPI.settings.setSpeechInputMode(mode);
    set({ speechInputMode: mode });
  },

  setSettingsOpen: (isOpen) => {
    set({ isSettingsOpen: isOpen });
  },
}));
