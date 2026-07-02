/**
 * Shared AI Model Resolver for Automation Modules
 *
 * Aligns supported AI providers (OpenAI, Anthropic, Gemini, Groq, DeepSeek, Nebius, OpenRouter)
 * and eliminates unsafe fallback / fallthrough behavior across planning, evaluation, parsing, and recovery.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createDeepSeek } from '@ai-sdk/deepseek';

export type ModelFlavor = 'fast' | 'powerful';

export function resolveModel(provider: string, apiKey: string | null, flavor: ModelFlavor = 'fast'): any {
  if (!apiKey) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey });
      return openai(flavor === 'powerful' ? 'gpt-4o' : 'gpt-4o-mini');
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(flavor === 'powerful' ? 'claude-3-5-sonnet-latest' : 'claude-3-5-haiku-20241022');
    }
    case 'gemini': {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(flavor === 'powerful' ? 'gemini-2.5-pro' : 'gemini-2.5-flash');
    }
    case 'groq': {
      const groq = createGroq({ apiKey });
      return groq('llama-3.3-70b-versatile');
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey });
      return deepseek(flavor === 'powerful' ? 'deepseek-reasoner' : 'deepseek-chat');
    }
    case 'nebius': {
      const nebius = createOpenAI({
        apiKey,
        baseURL: 'https://api.studio.nebius.ai/v1',
      });
      return nebius('meta-llama/Llama-3.3-70B-Instruct');
    }
    case 'openrouter': {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        headers: {
          'HTTP-Referer': 'https://github.com/ganeshmshetty/RemCtrl',
          'X-Title': 'RemoteCtrl',
        },
      });
      return openrouter(flavor === 'powerful' ? 'anthropic/claude-3.5-sonnet' : 'anthropic/claude-3.5-haiku');
    }
    default: {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
