import { ERROR_CODES, type AiFeature } from '../config/constants.js';
import { config } from '../config/env.js';
import { AiInteraction } from '../modules/aiInteractions/model.js';
import { getSettings } from '../modules/settings/service.js';
import { ApiError } from '../utils/ApiError.js';
import { endOfClinicDay, startOfClinicDay } from '../utils/dates.js';

/**
 * AI guards (spec §9.1): the settings kill switches, the per-user rate limits and the clinic's
 * daily call budget. Limits are counted from ai_interactions, so they hold across API instances
 * and cached answers never count.
 */

const FEATURE_SWITCH = {
  clinical_summary: 'clinicalSummaryEnabled',
  patient_explanation: 'patientExplanationEnabled',
} as const satisfies Record<AiFeature, string>;

const FEATURE_LABEL: Record<AiFeature, string> = {
  clinical_summary: 'AI clinical summaries are',
  patient_explanation: 'AI explanations are',
};

/** True when AI is on in settings, overall and for this feature (spec §6.5 kill switches). */
export async function isAiEnabled(feature: AiFeature): Promise<boolean> {
  const { ai } = await getSettings();
  return Boolean(ai?.enabled && ai[FEATURE_SWITCH[feature]]);
}

/** 403 AI_DISABLED when the clinic has turned AI (or this feature) off. */
export async function assertAiEnabled(feature: AiFeature): Promise<void> {
  if (await isAiEnabled(feature)) return;
  throw new ApiError(403, `${FEATURE_LABEL[feature]} turned off`, ERROR_CODES.AI_DISABLED);
}

/**
 * Per-user rate limit (429 RATE_LIMITED): counts the user's AI calls of this feature in the
 * window – the first attempt of each call only, so retries and fallback models do not use up
 * the user's quota (they count toward the daily budget instead).
 */
export async function assertAiQuota(
  feature: AiFeature,
  userId: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<void> {
  const used = await AiInteraction.countDocuments({
    user: userId,
    feature,
    attempt: 1,
    createdAt: { $gt: new Date(now.getTime() - windowMs) },
  });
  if (used >= limit) {
    throw ApiError.tooManyRequests('Too many AI requests – please try again in a little while', {
      limit,
      windowSeconds: Math.round(windowMs / 1000),
    });
  }
}

/** Every AI attempt made today (clinic timezone), whatever the feature or outcome. */
export async function callsToday(now = new Date()): Promise<number> {
  const { timezone } = await getSettings();
  return AiInteraction.countDocuments({
    createdAt: { $gte: startOfClinicDay(now, timezone), $lte: endOfClinicDay(now, timezone) },
  });
}

/** 503 AI_UNAVAILABLE once today's attempts reached AI_DAILY_CALL_LIMIT. */
export async function assertDailyBudget(now = new Date()): Promise<void> {
  const limit = config.ai.dailyCallLimit;
  if ((await callsToday(now)) < limit) return;
  throw new ApiError(503, 'Daily AI limit reached', ERROR_CODES.AI_UNAVAILABLE, {
    reason: 'daily_limit',
    limit,
  });
}
