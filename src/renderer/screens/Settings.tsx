import { useEffect, useState, type ReactNode } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Globe2,
  MonitorCog,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useSettingsStore } from '../stores/useWorkflowStore';
import { useUIStore } from '../stores/useUIStore';
import type { ApiProvider, BrowserMode } from '../../shared/types';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';
import './Settings.css';

type SettingsTab = 'general' | 'ai' | 'browser' | 'connection';

const TAB_DETAILS: Record<SettingsTab, { label: string; description: string; icon: typeof Settings2 }> = {
  general: { label: 'General', description: 'Appearance and app controls', icon: Settings2 },
  ai: { label: 'AI', description: 'Provider, model, and credentials', icon: Bot },
  browser: { label: 'Browser', description: 'Automation and profiles', icon: MonitorCog },
  connection: { label: 'Connection', description: 'Remote session signaling', icon: Globe2 },
};

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  vertex: 'Google Vertex AI',
  groq: 'Groq',
  deepseek: 'DeepSeek',
  nebius: 'Nebius',
  openrouter: 'OpenRouter',
};

export function Settings() {
  const {
    preferredProvider,
    preferredModel,
    hasOpenAIKey,
    hasAnthropicKey,
    hasGeminiKey,
    hasGroqKey,
    hasDeepseekKey,
    hasNebiusKey,
    hasOpenRouterKey,
    loadSettings,
    setSignalingUrl,
    setPreferredProvider,
    setPreferredModel,
    setApiKey,
    headlessMode,
    setHeadlessMode,
    keepBrowserOpenOnQuit,
    setKeepBrowserOpenOnQuit,
    browserProfile,
    setBrowserProfile,
    customProfiles,
    addCustomProfile,
    deleteCustomProfile,
    useVisionCUA,
    setUseVisionCUA,
    theme,
    setTheme,
  } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [apiInput, setApiInput] = useState('');
  const [signalingInput, setSignalingInput] = useState('');
  const [browserMode, setBrowserMode] = useState<BrowserMode>('internal');
  const [showKey, setShowKey] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [shortcutInput, setShortcutInput] = useState('');
  const [newProfileInput, setNewProfileInput] = useState('');
  const [cachedModels, setCachedModels] = useState<Record<string, string[]>>({});
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');

  useEffect(() => {
    void loadSettings().then(() => setSignalingInput(useSettingsStore.getState().signalingUrl));
    window.RemoteCtrlAPI?.settings.getBrowserMode().then(setBrowserMode).catch(() => {});
    window.RemoteCtrlAPI?.settings.getGlobalShortcut()
      .then((shortcut) => setShortcutInput(shortcut || 'CommandOrControl+Shift+Space'))
      .catch(() => setShortcutInput('CommandOrControl+Shift+Space'));
  }, [loadSettings]);

  useEffect(() => {
    void loadModels(preferredProvider);
  }, [preferredProvider]);

  function hasKeyForProvider(provider: ApiProvider) {
    const keys: Partial<Record<ApiProvider, boolean>> = {
      openai: hasOpenAIKey,
      anthropic: hasAnthropicKey,
      gemini: hasGeminiKey,
      groq: hasGroqKey,
      deepseek: hasDeepseekKey,
      nebius: hasNebiusKey,
      openrouter: hasOpenRouterKey,
      vertex: true,
    };
    return keys[provider] ?? false;
  }

  async function loadModels(provider: ApiProvider) {
    try {
      const models = await window.RemoteCtrlAPI?.settings.getAvailableModels(provider);
      if (!models?.length) return;
      setCachedModels((current) => ({ ...current, [provider]: models }));
      if (!useSettingsStore.getState().preferredModel) await setPreferredModel(models[0]);
    } catch {
      // The bundled model list is optional and the custom-model path remains available.
    }
  }

  function flash(message: string) {
    setSavedMsg(message);
    window.setTimeout(() => setSavedMsg(''), 2500);
  }

  async function handleProviderChange(provider: ApiProvider) {
    await setPreferredProvider(provider);
    setApiInput('');
    setIsCustomModel(false);
    const models = cachedModels[provider];
    if (models?.length) await setPreferredModel(models[0]);
  }

  async function handleSaveApiKey() {
    if (!apiInput.trim()) return;
    await setApiKey(preferredProvider, apiInput.trim());
    setApiInput('');
    flash('API key saved');
  }

  async function handleSaveCustomModel() {
    if (!customModelInput.trim()) return;
    await setPreferredModel(customModelInput.trim());
    setIsCustomModel(false);
    flash('Custom model saved');
  }

  async function handleSaveSignaling() {
    try {
      await setSignalingUrl(signalingInput.trim());
      flash('Connection settings saved');
    } catch {
      flash('Enter a valid signaling URL');
    }
  }

  async function handleSaveShortcut() {
    if (!shortcutInput.trim()) return;
    try {
      await window.RemoteCtrlAPI?.settings.setGlobalShortcut(shortcutInput.trim());
      flash('Shortcut saved — restart required');
    } catch {
      flash('Could not save shortcut');
    }
  }

  async function handleBrowserMode(mode: BrowserMode) {
    setBrowserMode(mode);
    await window.RemoteCtrlAPI?.settings.setBrowserMode(mode);
    flash('Browser mode saved');
  }

  async function handleCreateProfile() {
    const name = newProfileInput.trim();
    if (!name) return;
    await addCustomProfile(name);
    await setBrowserProfile(name);
    setNewProfileInput('');
    flash('Profile created');
  }

  async function handleResetBrowser() {
    if (!confirm('Reset this browser profile? This removes cookies, logins, and local storage.')) return;
    try {
      await window.RemoteCtrlAPI?.browser.resetProfile();
      flash('Browser profile reset');
    } catch {
      flash('Could not reset browser profile');
    }
  }

  const models = cachedModels[preferredProvider] ?? [];
  const hasCurrentKey = hasKeyForProvider(preferredProvider);
  const tab = TAB_DETAILS[activeTab];
  const close = () => useUIStore.getState().closeSettings();

  return (
    <Dialog.Root open={true} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="preferences-overlay" />
        <Dialog.Content className="preferences-window" aria-describedby={undefined}>
          <aside className="preferences-sidebar">
            <Dialog.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}>
              RemoteCtrl Settings
            </Dialog.Title>
            <div className="preferences-sidebar-title drag-region">RemoteCtrl</div>
            <nav className="preferences-nav" aria-label="Settings categories">
            {(Object.keys(TAB_DETAILS) as SettingsTab[]).map((id) => {
              const detail = TAB_DETAILS[id];
              const Icon = detail.icon;
              return (
                <button
                  key={id}
                  type="button"
                  className={`preferences-nav-item ${activeTab === id ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(id)}
                >
                  <Icon size={16} />
                  <span>{detail.label}</span>
                  {activeTab === id && <ChevronRight size={14} className="preferences-nav-chevron" />}
                </button>
              );
            })}
          </nav>
          <p className="preferences-sidebar-foot">Changes are saved locally on this device.</p>
        </aside>

        <main className="preferences-main">
          <header className="preferences-header drag-region">
            <div>
              <h1>{tab.label}</h1>
              <p>{tab.description}</p>
            </div>
            <div className="preferences-header-actions no-drag">
              {savedMsg && <span className="preferences-toast"><Check size={13} /> {savedMsg}</span>}
              <button type="button" className="preferences-close" onClick={close} aria-label="Close settings">
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="preferences-content no-drag">
            {activeTab === 'general' && (
              <>
                <PreferenceGroup title="Appearance" description="Choose how RemoteCtrl looks on this device.">
                  <PreferenceRow title="Theme" description="Follows your system setting by default.">
                    <PreferenceSelect
                      value={theme}
                      onChange={(val) => void setTheme(val as typeof theme)}
                      options={[
                        { value: 'system', label: 'System' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'light', label: 'Light' },
                      ]}
                      className="w-[168px]"
                    />
                  </PreferenceRow>
                </PreferenceGroup>

                <PreferenceGroup title="Quick access" description="Open the compact command window from anywhere.">
                  <PreferenceRow title="Global shortcut" description="Use Electron accelerator syntax. Restart RemoteCtrl after changing it.">
                    <div className="preferences-inline-control">
                      <input className="preferences-input preferences-shortcut" value={shortcutInput} onChange={(event) => setShortcutInput(event.target.value)} />
                      <button type="button" className="preferences-button" onClick={() => void handleSaveShortcut()} disabled={!shortcutInput.trim()}>Save</button>
                    </div>
                  </PreferenceRow>
                </PreferenceGroup>
              </>
            )}

            {activeTab === 'ai' && (
              <>
                <PreferenceGroup title="Model selection" description="Choose the provider and model used for agent tasks.">
                  <div className="preferences-grid">
                    <label className="preferences-control-label">Provider
                      <PreferenceSelect
                        value={preferredProvider}
                        onChange={(val) => void handleProviderChange(val as ApiProvider)}
                        options={(Object.keys(PROVIDER_LABELS) as ApiProvider[]).map((provider) => ({
                          value: provider,
                          label: PROVIDER_LABELS[provider],
                        }))}
                      />
                    </label>
                    <label className="preferences-control-label">Model
                      {isCustomModel ? (
                        <div className="preferences-inline-control">
                          <input className="preferences-input" value={customModelInput} onChange={(event) => setCustomModelInput(event.target.value)} placeholder="Model identifier" autoFocus />
                          <button type="button" className="preferences-button" onClick={() => void handleSaveCustomModel()}>Save</button>
                        </div>
                      ) : (
                        <PreferenceSelect
                          value={preferredModel ?? ''}
                          onChange={(val) =>
                            val === '__custom__'
                              ? (setCustomModelInput(preferredModel ?? ''), setIsCustomModel(true))
                              : void setPreferredModel(val)
                          }
                          options={[
                            ...models.map((model) => ({ value: model, label: model })),
                            ...((!!preferredModel && !models.includes(preferredModel))
                              ? [{ value: preferredModel, label: `${preferredModel} (Custom)` }]
                              : []),
                            { value: '__custom__', label: 'Custom model…' },
                          ]}
                        />
                      )}
                    </label>
                  </div>
                </PreferenceGroup>

                <PreferenceGroup title="Credentials" description="Keys are stored locally and are never sent to RemoteCtrl services.">
                  {preferredProvider === 'vertex' ? (
                    <PreferenceRow title="Google Vertex AI" description="Uses Application Default Credentials (ADC). Configure gcloud and your Google Cloud project in the environment.">
                      <StatusPill label="ADC" />
                    </PreferenceRow>
                  ) : (
                    <PreferenceRow title={`${PROVIDER_LABELS[preferredProvider]} API key`} description={hasCurrentKey ? 'A key is configured for this provider.' : 'No key has been saved yet.'}>
                      <div className="preferences-key-control">
                        <div className="preferences-key-input">
                          <input type={showKey ? 'text' : 'password'} className="preferences-input" placeholder={hasCurrentKey ? '••••••••••••••••' : 'Paste an API key'} value={apiInput} onChange={(event) => setApiInput(event.target.value)} autoComplete="off" spellCheck={false} />
                          <button type="button" className="preferences-reveal" onClick={() => setShowKey((shown) => !shown)} aria-label={showKey ? 'Hide API key' : 'Show API key'}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                        </div>
                        <button type="button" className="preferences-button" onClick={() => void handleSaveApiKey()} disabled={!apiInput.trim()}>Save key</button>
                      </div>
                    </PreferenceRow>
                  )}
                </PreferenceGroup>
              </>
            )}

            {activeTab === 'browser' && (
              <>
                 <PreferenceGroup title="Automation browser" description="Control which browser RemoteCtrl uses for automation.">
                  <PreferenceRow title="Browser mode" description={browserMode === 'internal' ? 'A managed, isolated browser profile.' : 'Connects to Chrome running with remote debugging on port 9222.'}>
                    <PreferenceSelect
                      value={browserMode}
                      onChange={(val) => void handleBrowserMode(val as BrowserMode)}
                      options={[
                        { value: 'internal', label: 'Internal browser' },
                        { value: 'local_chrome', label: 'Local Chrome' },
                      ]}
                      className="w-[168px]"
                    />
                  </PreferenceRow>
                  {browserMode === 'internal' && <PreferenceToggle title="Headless mode" description="Run the managed browser in the background." checked={headlessMode} onChange={(checked) => void setHeadlessMode(checked)} />}
                  {browserMode === 'internal' && <PreferenceToggle title="Keep browser open on quit" description="Leave the managed browser running when RemoteCtrl closes." checked={keepBrowserOpenOnQuit} onChange={(checked) => void setKeepBrowserOpenOnQuit(checked)} />}
                  {browserMode === 'internal' && <PreferenceToggle title="Vision fallback" description="Allow visual computer-use fallback for complex interfaces. Uses a 1288 × 711 viewport." checked={useVisionCUA} onChange={(checked) => void setUseVisionCUA(checked)} />}
                </PreferenceGroup>

                {browserMode === 'internal' && <PreferenceGroup title="Profiles" description="Profiles isolate browser cookies, sessions, and logins.">
                  <PreferenceRow title="Active profile" description="Switch profiles before starting a new browser session.">
                    <div className="preferences-inline-control">
                      <PreferenceSelect
                        value={browserProfile || 'default'}
                        onChange={(val) => void setBrowserProfile(val)}
                        options={[
                          { value: 'default', label: 'Default' },
                          { value: 'work', label: 'Work' },
                          { value: 'personal', label: 'Personal' },
                          { value: 'clean', label: 'Clean' },
                          ...customProfiles.map((profile) => ({ value: profile, label: profile })),
                        ]}
                      />
                      {customProfiles.includes(browserProfile) && <button type="button" className="preferences-icon-button preferences-danger" onClick={() => void deleteCustomProfile(browserProfile)} aria-label="Delete selected profile"><Trash2 size={15} /></button>}
                    </div>
                  </PreferenceRow>
                  <PreferenceRow title="New profile" description="Create another isolated browser space.">
                    <div className="preferences-inline-control">
                      <input className="preferences-input" value={newProfileInput} onChange={(event) => setNewProfileInput(event.target.value)} placeholder="e.g. Client A" />
                      <button type="button" className="preferences-button" onClick={() => void handleCreateProfile()} disabled={!newProfileInput.trim()}><Plus size={14} /> Create</button>
                    </div>
                  </PreferenceRow>
                </PreferenceGroup>}

                <PreferenceGroup title="Reset" description="This removes browser data from the active profile.">
                  <PreferenceRow title="Reset browser profile" description="Cookies, logins, local storage, and site preferences will be removed.">
                    <button type="button" className="preferences-button preferences-danger-button" onClick={() => void handleResetBrowser()}><RefreshCw size={14} /> Reset profile</button>
                  </PreferenceRow>
                </PreferenceGroup>
              </>
            )}

            {activeTab === 'connection' && (
              <PreferenceGroup title="Remote sessions" description="Use a custom signaling service for host and controller pairing.">
                <PreferenceRow title="Signaling server" description="The Socket.io service RemoteCtrl uses to establish remote sessions.">
                  <div className="preferences-inline-control">
                    <input type="url" className="preferences-input" value={signalingInput} onChange={(event) => setSignalingInput(event.target.value)} placeholder="http://localhost:3001" />
                    <button type="button" className="preferences-button" onClick={() => void handleSaveSignaling()}><Server size={14} /> Save</button>
                  </div>
                </PreferenceRow>
              </PreferenceGroup>
            )}
          </div>
        </main>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreferenceGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="preferences-group"><div className="preferences-group-heading"><h2>{title}</h2><p>{description}</p></div><div className="preferences-card">{children}</div></section>;
}

function PreferenceRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="preferences-row"><div className="preferences-row-copy"><strong>{title}</strong><span>{description}</span></div><div className="preferences-row-action">{children}</div></div>;
}

function PreferenceToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <PreferenceRow title={title} description={description}>
      <Switch.Root
        checked={checked}
        onCheckedChange={onChange}
        className="preferences-switch"
      >
        <Switch.Thumb className="preferences-switch-thumb" />
      </Switch.Root>
    </PreferenceRow>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className="preferences-status"><Check size={13} /> {label}</span>;
}

interface SelectOption {
  value: string;
  label: string;
}

function PreferenceSelect({
  value,
  onChange,
  options,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
}) {
  const selectedLabel = options.find((opt) => opt.value === value)?.label || value;

  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className={`preferences-select-trigger ${className}`}>
        <Select.Value>{selectedLabel}</Select.Value>
        <Select.Icon>
          <ChevronDown size={14} className="opacity-60" />
        </Select.Icon>
      </Select.Trigger>
      
      <Select.Portal>
        <Select.Content className="preferences-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="p-1">
            {options.map((opt) => (
              <Select.Item key={opt.value} value={opt.value} className="preferences-select-item">
                <Select.ItemText>{opt.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={12} className="text-[var(--accent)]" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
