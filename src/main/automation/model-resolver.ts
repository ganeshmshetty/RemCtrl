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

const AI_SDK_V2_COMPATIBLE_GEMINI_FALLBACK = 'gemini-2.5-flash';

/**
 * @ai-sdk/google currently exposes AI SDK specification v2 models only. Google
 * Gemini 3.x responses advertise v3, which produces a late opaque failure in
 * the Gemini provider's agent loop. Vertex uses the separate
 * @ai-sdk/google-vertex adapter and must not inherit this downgrade.
 */
export function resolveCompatibleModelId(provider: ApiProvider, requestedModel: string): string {
  if (provider === 'gemini' && /^gemini-3(?:\.|-)/i.test(requestedModel)) {
    console.warn(`[model] ${requestedModel} requires AI SDK specification v3; using ${AI_SDK_V2_COMPATIBLE_GEMINI_FALLBACK} until the provider adapter supports it.`);
    return AI_SDK_V2_COMPATIBLE_GEMINI_FALLBACK;
  }
  return requestedModel;
}

/**
 * Resolves the Vertex resource project without confusing ADC's quota project
 * with the project that owns the Vertex endpoint. GoogleAuth handles tokens;
 * this only supplies the project ID required by @ai-sdk/google-vertex.
 */
function getVertexProject(): string | undefined {
  const envProject =
    process.env.GOOGLE_VERTEX_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (envProject) return envProject;

  // A service-account ADC path carries the resource project explicitly.
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    try {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8')) as { project_id?: unknown };
      if (typeof credentials.project_id === 'string' && credentials.project_id.trim()) return credentials.project_id.trim();
    } catch {
      // GoogleAuth will report invalid credentials with its own actionable error.
    }
  }

  // gcloud's active project is the normal local-development resource project.
  try {
    const configPath = path.join(os.homedir(), '.config/gcloud/configurations/config_default');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const match = content.match(/^project\s*=\s*(.+)$/m);
      if (match?.[1]) return match[1].trim();
    }
  } catch {
    // Fall through to the ADC quota project only when no resource project is configured.
  }

  // This is only a last resort. quota_project_id controls billing/quota for
  // user ADC; it is not necessarily the project containing Vertex resources.
  try {
    const adcPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
    if (fs.existsSync(adcPath)) {
      const adc = JSON.parse(fs.readFileSync(adcPath, 'utf-8'));
      if (adc.quota_project_id) return adc.quota_project_id;
    }
  } catch {
    // No local user-ADC quota project; the caller will receive the project setup error below.
  }

  return undefined;
}

export function resolveModel(
  provider: string,
  apiKey: string | null,
  modelIdOverride?: string
// Provider packages publish their own versioned model interfaces. The AI SDK
// performs the definitive runtime compatibility check when a request starts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const typedProvider = (provider as ApiProvider) in PROVIDER_PROFILES ? (provider as ApiProvider) : 'openai';
  const profile = PROVIDER_PROFILES[typedProvider];
  const configuredModel = modelIdOverride || getPreferredModel() || profile.defaultModel;
  const targetModel = resolveCompatibleModelId(typedProvider, configuredModel);
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
      const project = getVertexProject();
      if (!project) {
        throw new Error('Vertex ADC needs a Google Cloud project. Set GOOGLE_VERTEX_PROJECT or run `gcloud config set project PROJECT_ID`, then run `gcloud auth application-default login`.');
      }
      // Use Vertex's global endpoint by default so globally available models
      // such as Gemini 3.5 do not depend on a regional model deployment.
      // Deployments that require a regional endpoint can override this below.
      const defaultLocation = 'global';
      const location =
        process.env.GOOGLE_VERTEX_LOCATION ||
        process.env.GOOGLE_CLOUD_LOCATION ||
        process.env.VERTEX_LOCATION ||
        defaultLocation;

      console.info(`[vertex] Using ADC for project="${project}" location="${location}" model="${targetModel}".`);

      // Let the provider own ADC token acquisition. This is the same call
      // shape proven to work in the remcon checkout and supports token refresh.
      return createVertex({
        baseURL: baseURL || undefined,
        location,
        project,
      })(targetModel);
    }
    default:
      return createOpenAI({ apiKey: apiKey || '', baseURL, headers })(targetModel);
  }
}
