/**
 * @filae provider-profiles.ts
 * @description Configuration registry mapping API providers to their default model IDs, base URLs, and connection protocols.
 * Key Exported APIs: `PROVIDER_PROFILES` record containing configurations for OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Nebius, OpenRouter, and Google Vertex AI. Also exports the `ProviderProfile` interface.
 * Relations: Direct integration with `model-resolver.ts` to locate baseline parameters, base URLs, and default engine identifiers when launching the LLM automation loop.
 */

import type { ApiProvider } from '../../shared/types.js';

export interface ProviderProfile {
  name: string;
  protocol: 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'vertex';
  baseURL?: string;
  defaultModel: string;
}

export const PROVIDER_PROFILES: Record<ApiProvider, ProviderProfile> = {
  openai: {
    name: 'OpenAI',
    protocol: 'openai',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    name: 'Anthropic',
    protocol: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
  },
  gemini: {
    name: 'Google Gemini',
    protocol: 'gemini',
    defaultModel: 'gemini-2.5-pro',
  },
  groq: {
    name: 'Groq',
    protocol: 'openai-compatible',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  deepseek: {
    name: 'DeepSeek',
    protocol: 'openai-compatible',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  nebius: {
    name: 'Nebius Token Factory',
    protocol: 'openai-compatible',
    baseURL: 'https://api.studio.nebius.ai/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
  },
  openrouter: {
    name: 'OpenRouter',
    protocol: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
  },
  vertex: {
    name: 'Google Vertex AI',
    protocol: 'vertex',
    defaultModel: 'gemini-2.5-flash',
  },
};
