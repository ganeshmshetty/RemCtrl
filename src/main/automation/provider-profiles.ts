import type { ApiProvider } from '../../shared/types.js';

export interface ProviderProfile {
  name: string;
  protocol: 'openai' | 'anthropic' | 'gemini' | 'openai-compatible';
  stagehandPrefix: string;
  baseURL?: string;
  defaultModel: string;
}

export const PROVIDER_PROFILES: Record<ApiProvider, ProviderProfile> = {
  openai: {
    name: 'OpenAI',
    protocol: 'openai',
    stagehandPrefix: 'openai/',
    defaultModel: 'gpt-4o',
  },
  anthropic: {
    name: 'Anthropic',
    protocol: 'anthropic',
    stagehandPrefix: 'anthropic/',
    defaultModel: 'claude-3-5-sonnet-latest',
  },
  gemini: {
    name: 'Google Gemini',
    protocol: 'gemini',
    stagehandPrefix: 'google/',
    defaultModel: 'gemini-2.5-pro',
  },
  groq: {
    name: 'Groq',
    protocol: 'openai-compatible',
    stagehandPrefix: 'groq/',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  deepseek: {
    name: 'DeepSeek',
    protocol: 'openai-compatible',
    stagehandPrefix: 'deepseek/',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  nebius: {
    name: 'Nebius Token Factory',
    protocol: 'openai-compatible',
    // MUST use 'openai/' prefix for Stagehand to recognize the custom baseURL
    stagehandPrefix: 'openai/',
    baseURL: 'https://api.studio.nebius.ai/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
  },
  openrouter: {
    name: 'OpenRouter',
    protocol: 'openai-compatible',
    // MUST use 'openai/' prefix for Stagehand to recognize the custom baseURL
    stagehandPrefix: 'openai/',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
  },
};
