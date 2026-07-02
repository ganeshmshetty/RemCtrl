import { ipcMain, app } from 'electron';
import {
  SetApiKeySchema,
  SetSignalingUrlSchema,
  SetPreferredProviderSchema,
  BrowserModeSchema,
  SetCustomBaseUrlSchema,
} from '../../shared/schemas.js';
import {
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
  getApiKey,
  getHeadlessMode,
  setHeadlessMode,
  getModelsList,
  saveModelsList,
  getCustomBaseUrl,
  setCustomBaseUrl,
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
    if (!key && provider !== 'openrouter') return []; 
    
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

  ipcMain.handle('settings:getCustomBaseUrl', async (_e, provider: unknown) => {
    if (typeof provider !== 'string') return undefined;
    return getCustomBaseUrl(provider as any);
  });

  ipcMain.handle('settings:setCustomBaseUrl', async (_e, provider: unknown, url: unknown) => {
    const parsed = SetCustomBaseUrlSchema.parse({ provider, url });
    setCustomBaseUrl(parsed.provider, parsed.url);
  });

  ipcMain.handle('app:getDiagnostics', async () => {
    return {
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
      appVersion: app.getVersion(),
    };
  });
}
