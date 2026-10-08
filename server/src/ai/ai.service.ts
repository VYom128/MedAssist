import { createHash, randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import type { z } from 'zod';
import {
  AI_RULES,
  AUDIT_ACTIONS,
  ERROR_CODES,
  type AiFailureReason,
  type AiFeature,
} from '../config/constants.js';
import { config } from '../config/env.js';
import { AiInteraction } from '../modules/aiInteractions/model.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { canonicalJson } from '../utils/canonicalJson.js';
import { logger, serializeError } from '../utils/logger.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';
import { assertDailyBudget } from './guards.js';
import { getProvider, modelChain } from './providers/index.js';
import { AiProviderError, type TokenUsage } from './providers/types.js';

/**
 * The one way the app talks to an AI model (spec §9.1). Callers pass a versioned prompt and an
 * input that is ALREADY de-identified (ai/deidentify.ts); the user message is that input as JSON.
 *
 * The call tries AI_MODEL, then each fallback model in order, and stops at the first valid
 * reply. On one model, an unusable reply (not JSON, or failing the Zod schema) is retried once
 * with the validation problems appended; a 429, 5xx, timeout, network error or a second
 * unusable reply moves on to the next model; an auth failure stops at once (the key is shared).
 * Every attempt is its own ai_interactions row (callId, attempt, model) and counts toward the
 * daily budget, which is checked before each attempt. One `ai.call` audit entry per call.
 *
 * Nothing here logs or stores prompts or outputs.
 */

type Id = string | Types.ObjectId;

export interface AiCallRequest<T> {
  feature: AiFeature;
  /** e.g. 'clinicalSummary.v1' – stored with every output. */
  promptVersion: string;
  schemaName: string;
  system: string;
  /** The de-identified input (hashed for ai_interactions, never stored). */
  input: Record<string, unknown>;
  /** The user message built from `input`. */
  userMessage: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Who asked (null for scripts such as the eval) – also the rate-limit key. */
  user: AuthUser | null;
  patient?: Id | null;
  source?: { type: string; id: Id; version?: number };
  meta?: RequestMeta;
}

export interface AiCallResult<T> {
  data: T;
  callId: string;
  /** The model that produced `data`. */
  model: string;
  /** True when `model` is a fallback, not AI_MODEL. */
  isFallback: boolean;
  provider: string;
  /** All attempts of the call. */
  attempts: number;
  /** The answering model needed a second try (invalid first reply). */
  retried: boolean;
  usage: TokenUsage;
  latencyMs: number;
  /** The ai_interactions row of the successful attempt. */
  interactionId: Types.ObjectId | null;
}

/** A failed AI call (503), with what the caller may record about it – never content. */
export class AiCallError extends ApiError {
  readonly callId: string;
  readonly attempts: number;
  readonly reasons: AiFailureReason[];

  constructor(
    code: typeof ERROR_CODES.AI_UNAVAILABLE | typeof ERROR_CODES.AI_OUTPUT_INVALID,
    message: string,
    info: { callId: string; attempts: number; reasons: AiFailureReason[]; details?: unknown },
  ) {
    super(503, message, code, info.details);
    this.callId = info.callId;
    this.attempts = info.attempts;
    this.reasons = info.reasons;
  }
}

/** SHA-256 of the canonical JSON of the de-identified input (spec §6.26). */
export function hashInput(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

interface AttemptRow {
  attempt: number;
  model: string;
  isFallback: boolean;
  status: 'success' | 'failed';
  errorReason?: AiFailureReason;
  guardrailFlags?: string[];
  usage: TokenUsage;
  latencyMs: number;
}

const MESSAGES = {
  busy: 'The AI is busy, try again in a minute',
  unavailable: 'The AI assistant is not available right now – please write it manually',
  invalid: "The AI assistant couldn't produce a usable result – please write it manually",
};

/** Errors that end the whole call at once (no other model would do better). */
const STOP_CHAIN: ReadonlySet<AiFailureReason> = new Set(['auth']);
/** Errors worth one more try on the same model, with the problems explained. */
const RETRY_SAME_MODEL: ReadonlySet<AiFailureReason> = new Set(['invalid_output', 'truncated']);

export async function generateJson<T>(request: AiCallRequest<T>): Promise<AiCallResult<T>> {
  const callId = randomUUID();
  const inputHash = hashInput(request.input);
  const provider = getProvider();
  const providerName = provider?.name ?? 'none';
  const chain = modelChain();
  const primary = chain[0];
  const started = Date.now();
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const reasons: AiFailureReason[] = [];
  const modelsTried: string[] = [];
  let attempt = 0;
  let retryAfter: number | undefined;

  const record = async (row: AttemptRow) => {
    try {
      const saved = await AiInteraction.create({
        callId,
        feature: request.feature,
        user: request.user?.id,
        patient: request.patient ?? undefined,
        source: request.source,
        provider: providerName,
        promptVersion: request.promptVersion,
        inputHash,
        ...row,
      });
      return saved._id;
    } catch (err) {
      logger.error(
        { err: serializeError(err), feature: request.feature },
        'Could not record AI interaction',
      );
      return null;
    }
  };

  const finish = async (status: 'success' | 'failure', extra: Record<string, unknown> = {}) => {
    await audit.record({
      action: AUDIT_ACTIONS.AI_CALL,
      outcome: status,
      actor: request.user ? actorOf(request.user) : { user: null, role: 'system', name: 'AI' },
      resource: request.source
        ? { type: request.source.type, id: request.source.id }
        : { type: 'ai_call' },
      patient: request.patient ?? null,
      request: request.meta,
      metadata: {
        callId,
        feature: request.feature,
        promptVersion: request.promptVersion,
        provider: providerName,
        models: modelsTried,
        attempts: attempt,
        failures: reasons,
        ...extra,
      },
    });
  };

  const fail = async (
    code: typeof ERROR_CODES.AI_UNAVAILABLE | typeof ERROR_CODES.AI_OUTPUT_INVALID,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<never> => {
    await finish('failure', { errorCode: code });
    throw new AiCallError(code, message, { callId, attempts: attempt, reasons, details });
  };

  if (!provider || !primary) {
    reasons.push('provider_disabled');
    return fail(ERROR_CODES.AI_UNAVAILABLE, MESSAGES.unavailable);
  }

  for (const model of chain) {
    const isFallback = model !== primary;
    let userMessage = request.userMessage;
    modelsTried.push(model);
    for (let onModel = 1; onModel <= AI_RULES.attemptsPerModel; onModel += 1) {
      try {
        await assertDailyBudget();
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        return fail(ERROR_CODES.AI_UNAVAILABLE, err.message, {
          ...(err.details as Record<string, unknown>),
        });
      }
      attempt += 1;
      const attemptStarted = Date.now();
      try {
        const reply = await provider.generateJson({
          system: request.system,
          user: userMessage,
          schema: request.schema,
          schemaName: request.schemaName,
          maxTokens: request.maxTokens ?? config.ai.maxTokens,
          model,
        });
        total.inputTokens += reply.usage.inputTokens;
        total.outputTokens += reply.usage.outputTokens;
        const interactionId = await record({
          attempt,
          model: reply.model,
          isFallback,
          status: 'success',
          usage: reply.usage,
          latencyMs: reply.latencyMs,
        });
        await finish('success', { model: reply.model, isFallback });
        return {
          data: reply.data,
          callId,
          model: reply.model,
          isFallback,
          provider: providerName,
          attempts: attempt,
          retried: onModel > 1,
          usage: total,
          latencyMs: Date.now() - started,
          interactionId,
        };
      } catch (err) {
        if (!(err instanceof AiProviderError)) throw err;
        total.inputTokens += err.usage.inputTokens;
        total.outputTokens += err.usage.outputTokens;
        reasons.push(err.reason);
        await record({
          attempt,
          model,
          isFallback,
          status: 'failed',
          errorReason: err.reason,
          usage: err.usage,
          latencyMs: err.latencyMs || Date.now() - attemptStarted,
        });
        if (err.reason === 'rate_limited' && err.retryAfterSeconds !== undefined) {
          retryAfter = Math.max(retryAfter ?? 0, err.retryAfterSeconds);
        }
        if (STOP_CHAIN.has(err.reason)) {
          return fail(ERROR_CODES.AI_UNAVAILABLE, MESSAGES.unavailable);
        }
        if (!RETRY_SAME_MODEL.has(err.reason)) break; // next model
        userMessage =
          `${request.userMessage}\n\nYour previous reply could not be used ` +
          `(${err.issues ?? 'invalid output'}). Reply again with only one JSON object that ` +
          'matches the required shape exactly.';
      }
    }
  }

  // Every model failed: what happened on each model's last attempt decides the error.
  if (reasons.every((r) => r === 'rate_limited')) {
    return fail(
      ERROR_CODES.AI_UNAVAILABLE,
      MESSAGES.busy,
      retryAfter === undefined ? undefined : { retryAfter },
    );
  }
  if (reasons.every((r) => RETRY_SAME_MODEL.has(r))) {
    return fail(ERROR_CODES.AI_OUTPUT_INVALID, MESSAGES.invalid);
  }
  return fail(ERROR_CODES.AI_UNAVAILABLE, MESSAGES.unavailable);
}
