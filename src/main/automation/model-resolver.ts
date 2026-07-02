/**
 * Shared AI Model Resolver for Automation Modules
 *
 * Uses the static Provider Profile Registry to resolve Vercel AI SDK instances
 * and generate Stagehand v3 model configurations without arbitrary flavor tiers.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ApiProvider } from '../../shared/types.js';
import { getPreferredModel, getCustomBaseUrl } from '../storage.js';
import { PROVIDER_PROFILES } from './provider-profiles.js';

export function resolveModel(
  provider: string,
  apiKey: string | null,
  modelIdOverride?: string,
  customBaseURLOverride?: string
): any {
  if (!apiKey) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  const typedProvider = (provider as ApiProvider) in PROVIDER_PROFILES ? (provider as ApiProvider) : 'openai';
  const profile = PROVIDER_PROFILES[typedProvider];
  const targetModel = modelIdOverride || getPreferredModel() || profile.defaultModel;
  const baseURL = customBaseURLOverride || getCustomBaseUrl(typedProvider) || profile.baseURL;

  const headers = typedProvider === 'openrouter' ? {
    'HTTP-Referer': 'https://github.com/ganeshmshetty/RemCtrl',
    'X-Title': 'RemoteCtrl',
  } : undefined;

  switch (profile.protocol) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL, headers })(targetModel);
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL, headers })(targetModel);
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey, baseURL, headers })(targetModel);
    case 'openai-compatible':
      return createOpenAI({ apiKey, baseURL, headers })(targetModel);
    default:
      return createOpenAI({ apiKey, baseURL, headers })(targetModel);
  }
}

export interface StagehandModelConfig {
  modelName: string;
  modelClientOptions: {
    apiKey: string;
    baseURL?: string;
  };
}

export function getStagehandModelConfig(
  provider: string,
  apiKey: string | null,
  modelIdOverride?: string
): StagehandModelConfig {
  if (!apiKey) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  const typedProvider = (provider as ApiProvider) in PROVIDER_PROFILES ? (provider as ApiProvider) : 'openai';
  const profile = PROVIDER_PROFILES[typedProvider];
  const targetModel = modelIdOverride || getPreferredModel() || profile.defaultModel;
  const baseURL = getCustomBaseUrl(typedProvider) || profile.baseURL;

  const modelName = targetModel.startsWith(profile.stagehandPrefix)
    ? targetModel
    : `${profile.stagehandPrefix}${targetModel}`;

  return {
    modelName,
    modelClientOptions: {
      apiKey,
      baseURL,
    },
  };
}
