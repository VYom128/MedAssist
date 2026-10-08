import type { Types } from 'mongoose';
import type { AiInteractionDoc } from './model.js';

/**
 * One row of the admin AI monitor: what happened, never content (ai_interactions stores none)
 * and no patient or user ids – the requester's role only.
 */
export type InteractionRow = Omit<AiInteractionDoc, 'user'> & {
  _id: Types.ObjectId;
  createdAt: Date;
  user?: { role?: string } | null;
};

export function toListItem(r: InteractionRow) {
  return {
    id: r._id.toString(),
    callId: r.callId,
    attempt: r.attempt,
    feature: r.feature,
    status: r.status,
    provider: r.provider,
    model: r.model ?? null,
    isFallbackModel: Boolean(r.isFallback),
    promptVersion: r.promptVersion,
    errorReason: r.errorReason ?? null,
    guardrailFlags: r.guardrailFlags ?? [],
    usage: {
      inputTokens: r.usage?.inputTokens ?? 0,
      outputTokens: r.usage?.outputTokens ?? 0,
    },
    latencyMs: r.latencyMs ?? 0,
    requestedByRole: r.user?.role ?? 'system',
    sourceType: r.source?.type ?? null,
    createdAt: r.createdAt,
  };
}
