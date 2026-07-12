import { ipcMain, app } from 'electron';
import {
  SetApiKeySchema,
  SetSignalingUrlSchema,
  SetPreferredProviderSchema,
  BrowserModeSchema,
  SetCustomBaseUrlSchema,
  SetThemeSchema,
  SetGlobalShortcutSchema,
} from '../../shared/schemas.js';
import {
  getApiKey,
  hasApiKey,
  setApiKey,
  getSignalingUrl,
  setSignalingUrl,
  getPreferredProvider,
  setPreferredProvider,
  getPreferredModel,
  setPreferredModel,
  getBrowserMode,
  setBrowserMode,
  getHeadlessMode,
  setHeadlessMode,
  getKeepBrowserOpenOnQuit,
  setKeepBrowserOpenOnQuit,
  getBrowserProfile,
  setBrowserProfile,
  getCustomProfiles,
  addCustomProfile,
  deleteCustomProfile,
  getModelsList,
  saveModelsList,
  getCustomBaseUrl,
  setCustomBaseUrl,
  getUseVisionCUA,
  setUseVisionCUA,
  getTheme,
  setTheme,
  getGlobalShortcut,
  setGlobalShortcut,
} from '../storage.js';

export function registerSettingsIpc() {
  ipcMain.handle('settings:hasApiKey', async (_e, provider: unknown) => {
    const { provider: p } = SetApiKeySchema.pick({ provider: true }).parse({ provider });
    return hasApiKey(p);
  });

  ipcMain.handle('settings:setApiKey', async (_e, provider: unknown, value: unknown) => {
    const parsed = SetApiKeySchema.parse({ provider, value });
    setApiKey(parsed.provider, parsed.value);
  });

  ipcMain.handle('settings:getSignalingUrl', async () => getSignalingUrl());

  ipcMain.handle('settings:setSignalingUrl', async (_e, url: unknown) => {
    const { url: u } = SetSignalingUrlSchema.parse({ url });
    setSignalingUrl(u);
  });

  ipcMain.handle('settings:getPreferredProvider', async () => getPreferredProvider());

  ipcMain.handle('settings:setPreferredProvider', async (_e, provider: unknown) => {
    const p = SetPreferredProviderSchema.parse({ provider });
    setPreferredProvider(p.provider);
  });

  ipcMain.handle('settings:getPreferredModel', async () => getPreferredModel());

  ipcMain.handle('settings:setPreferredModel', async (_e, model: unknown) => {
    if (typeof model === 'string') {
      setPreferredModel(model);
    }
  });

  ipcMain.handle('settings:fetchModels', async (_e, provider: unknown) => {
    if (typeof provider !== 'string') return [];
    
    let url = '';
    const key = getApiKey(provider as any);
    // Vertex uses ADC — no API key needed, but let it fall through to the switch
    if (!key && provider !== 'openrouter' && provider !== 'vertex') return [];
    
    let headers: Record<string, string> = {};
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    switch (provider) {
      case 'openai':
        url = 'https://api.openai.com/v1/models';
        break;
      case 'groq':
        url = 'https://api.groq.com/openai/v1/models';
        break;
      case 'deepseek':
        url = 'https://api.deepseek.com/models';
        break;
      case 'nebius':
        url = 'https://api.tokenfactory.nebius.com/v1/models';
        break;
      case 'openrouter':
        url = 'https://openrouter.ai/api/v1/models';
        headers['HTTP-Referer'] = 'https://github.com/ganeshmshetty/RemCtrl';
        headers['X-Title'] = 'RemoteCtrl';
        break;
      case 'vertex':
        // Vertex AI uses ADC — no fetchable list endpoint. Return well-known models.
        return [
          'gemini-3.5-flash',
          'gemini-2.5-pro',
          'gemini-2.5-flash',
          'gemini-2.5-flash-lite',
          'gemini-2.0-flash-001',
          'gemini-1.5-pro-002',
          'gemini-1.5-flash-002',
        ];
      default:
        return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) return [];
      const data = await res.json() as any;
      if (data && data.data && Array.isArray(data.data)) {
        const skipSuffixes = ['embed', 'embedding', 'moderation', 'image', 'vision', 'whisper', 'tts', 'dall-e'];
        const models = data.data
          .map((m: any) => m.id as string)
          .filter(Boolean)
          .filter((id: string) => {
            const lower = id.toLowerCase();
            return !skipSuffixes.some(suffix => lower.includes(suffix));
          });
        if (models.length > 0) {
          saveModelsList(provider as any, models);
        }
        return models;
      }
      return [];
    } catch (e) {
      console.error('Failed to fetch models', e);
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  });

  ipcMain.handle('settings:getAvailableModels', async (_e, provider: unknown) => {
    if (typeof provider === 'string') {
      return getModelsList(provider as any);
    }
    return [];
  });

  ipcMain.handle('settings:getBrowserMode', async () => getBrowserMode());

  ipcMain.handle('settings:setBrowserMode', async (_e, mode: unknown) => {
    const parsed = BrowserModeSchema.parse(mode);
    setBrowserMode(parsed);
  });

  ipcMain.handle('settings:getHeadlessMode', async () => getHeadlessMode());

  ipcMain.handle('settings:setHeadlessMode', async (_e, headless: unknown) => {
    setHeadlessMode(Boolean(headless));
  });

  ipcMain.handle('settings:getKeepBrowserOpenOnQuit', async () => getKeepBrowserOpenOnQuit());

  ipcMain.handle('settings:setKeepBrowserOpenOnQuit', async (_e, keepOpen: unknown) => {
    setKeepBrowserOpenOnQuit(Boolean(keepOpen));
  });

  ipcMain.handle('settings:getBrowserProfile', async () => getBrowserProfile());

  ipcMain.handle('settings:setBrowserProfile', async (_e, profile: unknown) => {
    setBrowserProfile(String(profile || 'default'));
  });

  ipcMain.handle('settings:getCustomProfiles', async () => getCustomProfiles());

  ipcMain.handle('settings:addCustomProfile', async (_e, name: unknown) => {
    addCustomProfile(String(name || ''));
  });

  ipcMain.handle('settings:deleteCustomProfile', async (_e, name: unknown) => {
    deleteCustomProfile(String(name || ''));
  });

  ipcMain.handle('settings:getUseVisionCUA', async () => getUseVisionCUA());

  ipcMain.handle('settings:setUseVisionCUA', async (_e, useCua: unknown) => {
    setUseVisionCUA(Boolean(useCua));
  });

  ipcMain.handle('settings:getCustomBaseUrl', async (_e, provider: unknown) => {
    if (typeof provider !== 'string') return undefined;
    return getCustomBaseUrl(provider as any);
  });

  ipcMain.handle('settings:setCustomBaseUrl', async (_e, provider: unknown, url: unknown) => {
    const parsed = SetCustomBaseUrlSchema.parse({ provider, url });
    setCustomBaseUrl(parsed.provider, parsed.url);
  });

  ipcMain.handle('settings:getTheme', async () => getTheme());

  ipcMain.handle('settings:setTheme', async (_e, theme: unknown) => {
    const parsed = SetThemeSchema.parse({ theme });
    setTheme(parsed.theme);
  });

  ipcMain.handle('settings:getGlobalShortcut', async () => getGlobalShortcut());

  ipcMain.handle('settings:setGlobalShortcut', async (_e, shortcut: unknown) => {
    const parsed = SetGlobalShortcutSchema.parse({ shortcut });
    setGlobalShortcut(parsed.shortcut.trim());
  });

  ipcMain.handle('app:getDiagnostics', async () => {
    return {
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
      appVersion: app.getVersion(),
    };
  });
}
