/**
 * @file model-resolver.ts
 * @description Model factory and resolver that returns the correct Vercel AI SDK model instance configured for a specific provider.
 * Key Exported APIs: `resolveModel` to dynamically instantiate model configurations.
 * Internal Mechanics: Resolves configured models based on user preference, custom base URLs, and environment configuration.
 * Authentication & Providers: Supports OpenAI, Anthropic, Gemini, Vertex AI, Groq, DeepSeek, Nebius, and OpenRouter. Handles Google Application Default Credentials (ADC) for local developer environments or Vertex AI without explicit keys.
 * Relations: Coordinates with `PROVIDER_PROFILES` to fallback on default model versions and endpoints, and reads preferences from `storage.ts`.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import type { ApiProvider } from '../../shared/types.js';
import { getPreferredModel, getCustomBaseUrl } from '../storage.js';
import { PROVIDER_PROFILES } from './provider-profiles.js';

import fs from 'fs';
import path from 'path';
import os from 'os';

function getDefaultGcpProject(): string | undefined {
  const envProject =
    process.env.GOOGLE_VERTEX_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (envProject) return envProject;

  try {
    const adcPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
    if (fs.existsSync(adcPath)) {
      const adc = JSON.parse(fs.readFileSync(adcPath, 'utf-8'));
      if (adc.quota_project_id) return adc.quota_project_id;
    }
  } catch {}

  try {
    const configPath = path.join(os.homedir(), '.config/gcloud/configurations/config_default');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const match = content.match(/^project\s*=\s*(.+)$/m);
      if (match?.[1]) return match[1].trim();
    }
  } catch {}

  return undefined;
}

async function adcAuthFetch(input: any, init?: any): Promise<Response> {
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const headers = new Headers(init?.headers);
    if (token?.token) {
      headers.set('Authorization', `Bearer ${token.token}`);
    }
    return fetch(input, { ...init, headers });
  } catch {
    return fetch(input, init);
  }
}

export function resolveModel(
  provider: string,
  apiKey: string | null,
  modelIdOverride?: string
): any {
  const typedProvider = (provider as ApiProvider) in PROVIDER_PROFILES ? (provider as ApiProvider) : 'openai';
  const profile = PROVIDER_PROFILES[typedProvider];
  const targetModel = modelIdOverride || getPreferredModel() || profile.defaultModel;
  const baseURL = getCustomBaseUrl(typedProvider) || profile.baseURL;

  const headers: Record<string, string> = {};
  if (typedProvider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://remotectrl.app';
    headers['X-Title'] = 'RemoteCtrl';
  }

  switch (typedProvider) {
    case 'anthropic':
      return createAnthropic({ apiKey: apiKey || '', baseURL, headers })(targetModel);
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey: apiKey || '', baseURL, headers })(targetModel);
    case 'vertex': {
      const project = getDefaultGcpProject();
      const defaultLocation = targetModel.startsWith('gemini-3') ? 'global' : 'us-central1';
      const location =
        process.env.GOOGLE_VERTEX_LOCATION ||
        process.env.GOOGLE_CLOUD_LOCATION ||
        process.env.VERTEX_LOCATION ||
        defaultLocation;

      return createVertex({
        baseURL: baseURL || undefined,
        location,
        project,
        fetch: !apiKey ? adcAuthFetch : undefined,
      })(targetModel);
    }
    default:
      return createOpenAI({ apiKey: apiKey || '', baseURL, headers })(targetModel);
  }
}
