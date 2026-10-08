import type { Types } from 'mongoose';
import {
  AI_GUARDRAIL_FLAGS as FLAGS,
  ERROR_CODES,
  type ExplanationOutcome,
} from '../config/constants.js';
import type { AuthUser } from '../types/express.js';
import type { RequestMeta } from '../utils/requestContext.js';
import { AiCallError, generateJson } from './ai.service.js';
import { buildTemplateExplanation } from './explanationTemplate.js';
import { checkExplanation } from './guardrails.js';
import {
  buildUserMessage,
  explanationOutputSchema,
  PROMPT_VERSION,
  SCHEMA_NAME,
  systemPrompt,
  type ExplanationInput,
  type ExplanationOutput,
} from './prompts/patientExplanation.v1.js';

/**
 * The patient explanation pipeline (spec §9.3): generate (ai.service: model chain, one Zod retry
 * per model) → guardrails → on a block, regenerate once (same call) → still blocked → the
 * deterministic template. When the AI is unavailable (errors, daily limit) the template is used
 * too. Never throws an AI error: the patient always gets an explanation.
 *
 * `cacheable`: model text that passed, or the template after a guardrail block (asking again
 * would be blocked again). A template after an AI failure is not cached, so a later request can
 * still get the model's explanation.
 */
export interface ExplanationRun {
  content: ExplanationOutput;
  isFallback: boolean;
  outcome: ExplanationOutcome;
  flags: string[];
  cacheable: boolean;
  promptVersion: string;
  model: string | null;
  isFallbackModel: boolean;
  callId: string | null;
  interactionId: Types.ObjectId | null;
  attempts: number;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export interface ExplanationContext {
  user: AuthUser | null;
  patient?: Types.ObjectId | string | null;
  source?: { type: string; id: Types.ObjectId | string; version?: number };
  meta?: RequestMeta;
}

export async function runExplanation(
  input: ExplanationInput,
  ctx: ExplanationContext,
): Promise<ExplanationRun> {
  const started = Date.now();
  const flags: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const userMessage = buildUserMessage(input);
  const request = {
    feature: 'patient_explanation' as const,
    promptVersion: PROMPT_VERSION,
    schemaName: SCHEMA_NAME,
    system: systemPrompt(input.language, input.readingAge),
    input: input as unknown as Record<string, unknown>,
    userMessage,
    schema: explanationOutputSchema,
    user: ctx.user,
    patient: ctx.patient,
    source: ctx.source,
    meta: ctx.meta,
    check: (data: ExplanationOutput) => checkExplanation(data, input),
  };
  const base = {
    promptVersion: PROMPT_VERSION,
    model: null as string | null,
    isFallbackModel: false,
    callId: null as string | null,
    interactionId: null as Types.ObjectId | null,
    attempts: 0,
    usage,
  };
  const done = (run: Omit<ExplanationRun, 'latencyMs' | 'flags' | 'promptVersion' | 'usage'>) => ({
    ...run,
    promptVersion: PROMPT_VERSION,
    usage,
    flags: [...new Set(flags)],
    latencyMs: Date.now() - started,
  });

  try {
    let result = await generateJson(request);
    for (const generation of [1, 2]) {
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      if (result.retried) flags.push(FLAGS.OUTPUT_RETRIED);
      if (result.isFallback) flags.push(FLAGS.FALLBACK_MODEL);
      const common = {
        model: result.model,
        isFallbackModel: result.isFallback,
        callId: result.callId,
        interactionId: result.interactionId,
        attempts: result.attempts,
      };
      if (result.blockedFlags.length === 0) {
        return done({
          ...common,
          content: result.data,
          isFallback: false,
          outcome: 'success',
          cacheable: true,
        });
      }
      flags.push(...result.blockedFlags);
      if (generation === 2) {
        flags.push(FLAGS.FALLBACK_TEMPLATE);
        return done({
          ...common,
          content: buildTemplateExplanation(input),
          isFallback: true,
          outcome: 'blocked',
          cacheable: true,
        });
      }
      flags.push(FLAGS.REGENERATED);
      result = await generateJson({
        ...request,
        userMessage:
          `${userMessage}\n\nYour previous answer broke these rules: ` +
          `${result.blockedFlags.join(', ')}. Restate only what is written, explain every ` +
          'medicine exactly once with its name as written, copy every number and unit exactly, ' +
          'never diagnose and never suggest changing or stopping a medicine.',
        continueFrom: { callId: result.callId, attempts: result.attempts },
      });
    }
  } catch (err) {
    if (!(err instanceof AiCallError)) throw err;
    const dailyLimit = (err.details as { reason?: string } | undefined)?.reason === 'daily_limit';
    flags.push(
      dailyLimit
        ? FLAGS.DAILY_LIMIT
        : err.code === ERROR_CODES.AI_OUTPUT_INVALID
          ? FLAGS.AI_OUTPUT_INVALID
          : FLAGS.AI_UNAVAILABLE,
      FLAGS.FALLBACK_TEMPLATE,
    );
    return done({
      ...base,
      callId: err.callId,
      attempts: err.attempts,
      content: buildTemplateExplanation(input),
      isFallback: true,
      outcome: 'failed',
      cacheable: false,
    });
  }
  /* c8 ignore next */
  throw new Error('unreachable');
}
