import type { z } from 'zod';
import type { AiFailureReason } from '../../config/constants.js';

/**
 * AI provider interface (spec §9.1). A provider makes ONE call to ONE model and returns the
 * reply parsed as JSON and validated with the Zod schema – or throws an AiProviderError.
 * Retries and the model fallback chain live in ai.service. Providers never log prompts or
 * outputs.
 */

export type AiProviderName = 'mock' | 'openai_compatible';

export interface GenerateJsonRequest<T> {
  system: string;
  /** The user message: the de-identified input as JSON (plus retry notes). */
  user: string;
  schema: z.ZodType<T>;
  /** Names the expected shape, e.g. 'clinical_summary' (the mock builds its reply from it). */
  schemaName: string;
  maxTokens: number;
  model: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateJsonResult<T> {
  data: T;
  /** The model that answered (as the provider reports it). */
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}

export interface AiProvider {
  readonly name: AiProviderName;
  generateJson<T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>>;
}

export const NO_USAGE: TokenUsage = Object.freeze({ inputTokens: 0, outputTokens: 0 });

/**
 * One failed provider call. `reason` is a machine tag; `issues` (invalid output only) lists the
 * validation problems as paths + Zod messages – never values. Nothing here carries content from
 * the request or the reply.
 */
export class AiProviderError extends Error {
  readonly reason: AiFailureReason;
  readonly model: string;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  /** Seconds to wait, from a 429's Retry-After header. */
  readonly retryAfterSeconds: number | undefined;
  readonly issues: string | undefined;

  constructor(
    reason: AiFailureReason,
    info: {
      model: string;
      usage?: TokenUsage;
      latencyMs?: number;
      retryAfterSeconds?: number;
      issues?: string;
    },
  ) {
    super(`AI provider error: ${reason}`);
    this.name = 'AiProviderError';
    this.reason = reason;
    this.model = info.model;
    this.usage = info.usage ?? NO_USAGE;
    this.latencyMs = info.latencyMs ?? 0;
    this.retryAfterSeconds = info.retryAfterSeconds;
    this.issues = info.issues;
  }
}
