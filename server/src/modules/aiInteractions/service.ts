import type { PipelineStage } from 'mongoose';
import { callsToday } from '../../ai/guards.js';
import { modelChain, usingMock } from '../../ai/providers/index.js';
import { config } from '../../config/env.js';
import { addDaysToDate, clinicToday, endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { PatientExplanation } from '../explanations/model.js';
import { getSettings } from '../settings/service.js';
import { AiInteraction } from './model.js';
import { toListItem, type InteractionRow } from './serializer.js';
import type { InteractionSummaryQuery, ListInteractionsQuery } from './validation.js';

/**
 * The admin AI monitor (spec §7.18, Phase 9): AI attempts and their outcomes, rates, tokens and
 * latency – never prompts, inputs or outputs (ai_interactions holds none), never the API key.
 */

const DEFAULT_DAYS = 30;

/** [from, to] clinic dates → UTC instants (default: the last 30 clinic days, today included). */
async function window(q: { from?: string; to?: string }) {
  const { timezone } = await getSettings();
  const to = q.to ?? clinicToday(timezone);
  const from = q.from ?? addDaysToDate(to, -(DEFAULT_DAYS - 1));
  return {
    from,
    to,
    createdAt: { $gte: startOfClinicDay(from, timezone), $lte: endOfClinicDay(to, timezone) },
  };
}

/** GET /ai/interactions – newest first, filtered by feature, status, model and dates. */
export async function listInteractions(
  q: ListInteractionsQuery,
  { page, limit, skip }: Pagination,
) {
  const { createdAt } = await window(q);
  const filter = {
    createdAt,
    ...(q.feature ? { feature: q.feature } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.model ? { model: q.model } : {}),
  };
  const [rows, total] = await Promise.all([
    AiInteraction.find(filter)
      .select('-inputHash -patient -source.id')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'user', select: 'role' })
      .lean<InteractionRow[]>(),
    AiInteraction.countDocuments(filter),
  ]);
  return { items: rows.map(toListItem), meta: buildMeta({ page, limit, total }) };
}

const rate = (part: number, whole: number) => (whole ? Number((part / whole).toFixed(3)) : 0);

/**
 * GET /ai/interactions/summary – for [from, to]: attempts and calls, failure rate, fallback-model
 * rate, template-fallback rate, guardrail blocks (and flag counts), tokens, average and p95
 * latency, the patients' "helpful" share, and calls per model.
 */
export async function interactionSummary(q: InteractionSummaryQuery) {
  const { from, to, createdAt } = await window(q);
  const { timezone } = await getSettings();
  const match: PipelineStage.Match = { $match: { createdAt } };

  const [totals, flags, perModel, explanations, feedback, daily] = await Promise.all([
    AiInteraction.aggregate<{
      attempts: number;
      calls: string[];
      failed: number;
      blocked: number;
      successes: number;
      fallbackSuccesses: number;
      inputTokens: number;
      outputTokens: number;
      averageLatencyMs: number;
    }>([
      match,
      {
        $group: {
          _id: null,
          attempts: { $sum: 1 },
          calls: { $addToSet: '$callId' },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
          successes: { $sum: { $cond: [{ $ne: ['$status', 'failed'] }, 1, 0] } },
          fallbackSuccesses: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$status', 'failed'] }, '$isFallback'] }, 1, 0],
            },
          },
          inputTokens: { $sum: '$usage.inputTokens' },
          outputTokens: { $sum: '$usage.outputTokens' },
          averageLatencyMs: { $avg: '$latencyMs' },
        },
      },
    ]),
    AiInteraction.aggregate<{ _id: string; count: number }>([
      match,
      { $unwind: '$guardrailFlags' },
      { $group: { _id: '$guardrailFlags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    AiInteraction.aggregate<{
      _id: string | null;
      attempts: number;
      failed: number;
      blocked: number;
    }>([
      match,
      {
        $group: {
          _id: '$model',
          attempts: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
        },
      },
      { $sort: { attempts: -1, _id: 1 } },
    ]),
    PatientExplanation.aggregate<{ total: number; templates: number }>([
      { $match: { createdAt } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          templates: { $sum: { $cond: ['$isFallback', 1, 0] } },
        },
      },
    ]),
    PatientExplanation.aggregate<{ rated: number; helpful: number }>([
      { $match: { 'feedback.at': createdAt } },
      {
        $group: {
          _id: null,
          rated: { $sum: 1 },
          helpful: { $sum: { $cond: ['$feedback.helpful', 1, 0] } },
        },
      },
    ]),
    // Attempts per clinic day, for the monitor's charts.
    AiInteraction.aggregate<{
      _id: string;
      attempts: number;
      failed: number;
      blocked: number;
      tokens: number;
    }>([
      match,
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } },
          attempts: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
          tokens: {
            $sum: {
              $add: [
                { $ifNull: ['$usage.inputTokens', 0] },
                { $ifNull: ['$usage.outputTokens', 0] },
              ],
            },
          },
        },
      },
    ]),
  ]);

  const t = totals[0];
  const attempts = t?.attempts ?? 0;
  // 95th percentile (nearest rank) without loading every row.
  let p95LatencyMs = 0;
  if (attempts > 0) {
    const row = await AiInteraction.findOne({ createdAt })
      .sort({ latencyMs: 1, _id: 1 })
      .skip(Math.ceil(0.95 * attempts) - 1)
      .select('latencyMs')
      .lean();
    p95LatencyMs = row?.latencyMs ?? 0;
  }
  const exp = explanations[0] ?? { total: 0, templates: 0 };
  const fb = feedback[0] ?? { rated: 0, helpful: 0 };
  return {
    range: { from, to },
    attempts,
    calls: t?.calls.length ?? 0,
    failureRate: rate(t?.failed ?? 0, attempts),
    fallbackModelRate: rate(t?.fallbackSuccesses ?? 0, t?.successes ?? 0),
    templateFallbackRate: rate(exp.templates, exp.total),
    explanations: exp.total,
    guardrailBlocks: t?.blocked ?? 0,
    guardrailFlags: flags.map((f) => ({ flag: f._id, count: f.count })),
    tokens: { input: t?.inputTokens ?? 0, output: t?.outputTokens ?? 0 },
    latency: { averageMs: Math.round(t?.averageLatencyMs ?? 0), p95Ms: p95LatencyMs },
    feedback: {
      rated: fb.rated,
      helpful: fb.helpful,
      helpfulPercent: fb.rated ? Number(((fb.helpful / fb.rated) * 100).toFixed(1)) : null,
    },
    perModel: perModel.map((m) => ({
      model: m._id ?? 'none',
      attempts: m.attempts,
      failed: m.failed,
      blocked: m.blocked,
    })),
    /** Every clinic day in [from, to] (zeros included), oldest first. */
    perDay: daysBetween(from, to).map((date) => {
      const d = daily.find((r) => r._id === date);
      return {
        date,
        attempts: d?.attempts ?? 0,
        failed: d?.failed ?? 0,
        blocked: d?.blocked ?? 0,
        tokens: d?.tokens ?? 0,
      };
    }),
  };
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 366; d = addDaysToDate(d, 1)) days.push(d);
  return days;
}

/** GET /ai/config – what the server is set up to use (the base URL's host only, never the key). */
export async function aiConfig() {
  const mock = usingMock();
  let baseUrlHost: string | null = null;
  if (!mock) {
    try {
      baseUrlHost = new URL(config.ai.baseUrl).host;
    } catch {
      baseUrlHost = null;
    }
  }
  const [model, ...fallbackModels] = modelChain();
  const { ai } = await getSettings();
  return {
    provider: mock ? 'mock' : config.ai.provider,
    baseUrlHost,
    model,
    fallbackModels,
    timeoutMs: config.ai.timeoutMs,
    temperature: config.ai.temperature,
    maxTokens: config.ai.maxTokens,
    today: { calls: await callsToday(), limit: config.ai.dailyCallLimit },
    enabled: {
      ai: Boolean(ai?.enabled),
      clinicalSummary: Boolean(ai?.clinicalSummaryEnabled),
      patientExplanation: Boolean(ai?.patientExplanationEnabled),
      explanationLanguages: [...(ai?.explanationLanguages ?? [])],
    },
  };
}
