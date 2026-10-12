import { AiInteraction } from '../../aiInteractions/model.js';
import { inRange, type ClinicRange } from './range.js';

/**
 * AI usage (spec §14, Phase 9 log): calls (first attempts), all attempts, failed and blocked
 * attempts and tokens in the range – numbers only, never content.
 */
export async function aiUsage(r: ClinicRange) {
  const [row] = await AiInteraction.aggregate<{
    calls: number;
    attempts: number;
    failed: number;
    blocked: number;
    tokens: number;
  }>([
    { $match: inRange('createdAt', r) },
    {
      $group: {
        _id: null,
        attempts: { $sum: 1 },
        calls: { $sum: { $cond: [{ $eq: ['$attempt', 1] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
        tokens: { $sum: { $add: ['$usage.inputTokens', '$usage.outputTokens'] } },
      },
    },
  ]);
  return {
    calls: row?.calls ?? 0,
    attempts: row?.attempts ?? 0,
    failed: row?.failed ?? 0,
    blocked: row?.blocked ?? 0,
    tokens: row?.tokens ?? 0,
  };
}
