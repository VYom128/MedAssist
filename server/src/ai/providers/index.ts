import { config } from '../../config/env.js';
import { mockProvider } from './mock.js';
import { openAiCompatibleProvider } from './openaiCompatible.js';
import type { AiProvider } from './types.js';

let forcedMock = false;

/** The seed always uses the mock provider, whatever AI_PROVIDER says (tests do via config). */
export function forceMockProvider(): void {
  forcedMock = true;
}

/** True when AI calls go to the mock provider. */
export function usingMock(): boolean {
  return forcedMock || config.ai.provider === 'mock';
}

/**
 * The provider for this process. Production never answers from the mock (it would show fake
 * output to doctors and patients): `null` = refuse the call (503 AI_UNAVAILABLE).
 */
export function getProvider(): AiProvider | null {
  if (forcedMock) return mockProvider;
  if (config.ai.provider === 'openai_compatible') return openAiCompatibleProvider;
  return config.isProd ? null : mockProvider;
}

/** The models to try, in order: AI_MODEL, then AI_FALLBACK_MODELS (duplicates dropped). */
export function modelChain(): string[] {
  return [...new Set([config.ai.model, ...config.ai.fallbackModels])];
}

export type { AiProvider } from './types.js';
