import type { Types } from 'mongoose';
import type { PatientExplanationDoc } from './model.js';

/**
 * Explanation views (spec §9.3). Patients see the content, the fixed disclaimer and contact list,
 * whether it is the template, and their feedback; doctors (preview) also see the guardrail flags.
 */
export type ExplanationLike = PatientExplanationDoc & {
  _id: Types.ObjectId;
  createdAt?: Date;
};

export const EXPLANATION_LABEL = 'Explained in simple words by AI, from your doctor’s instructions';

export function toView(x: ExplanationLike, options: { fromCache: boolean; forDoctor: boolean }) {
  const c = x.content;
  return {
    id: x._id.toString(),
    sourceType: x.sourceType,
    sourceId: x.sourceId.toString(),
    sourceVersion: x.sourceVersion,
    language: x.language,
    label: EXPLANATION_LABEL,
    content: {
      overview: c?.overview ?? '',
      medicines: (c?.medicines ?? []).map((m) => ({
        name: m.name ?? '',
        whatToDo: m.whatToDo ?? '',
        whenToTake: m.whenToTake ?? '',
        howLong: m.howLong ?? '',
        tips: m.tips ?? [],
      })),
      followUp: c?.followUp ?? '',
      questionsToAskDoctor: c?.questionsToAskDoctor ?? [],
      whenToContactClinic: c?.whenToContactClinic ?? [],
    },
    disclaimer: x.disclaimer,
    isFallback: Boolean(x.isFallback),
    fromCache: options.fromCache,
    preview: Boolean(x.preview),
    generatedAt: x.createdAt ?? null,
    feedback: x.feedback?.at
      ? {
          helpful: Boolean(x.feedback.helpful),
          comment: x.feedback.comment ?? null,
          at: x.feedback.at,
        }
      : null,
    ...(options.forDoctor ? { guardrailFlags: x.guardrailFlags ?? [] } : {}),
  };
}
