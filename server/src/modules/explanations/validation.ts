import { z } from 'zod';
import { AI_RULES, EXPLANATION_LANGUAGES } from '../../config/constants.js';
import { idParams } from '../../utils/zod.js';

/** POST /prescriptions/:id/explain and /encounters/:id/follow-up/explain (spec §7.12, §7.13). */
export const explainSchema = {
  params: idParams,
  body: z.strictObject({ language: z.enum(EXPLANATION_LANGUAGES).default('en') }),
};

/** POST /prescriptions/:id/explain/feedback – on the cached explanation in that language. */
export const explanationFeedbackSchema = {
  params: idParams,
  body: z.strictObject({
    language: z.enum(EXPLANATION_LANGUAGES).default('en'),
    helpful: z.boolean(),
    comment: z
      .string()
      .trim()
      .max(AI_RULES.feedbackCommentMax, `At most ${AI_RULES.feedbackCommentMax} characters`)
      .optional(),
  }),
};

export type ExplainInput = z.infer<typeof explainSchema.body>;
export type ExplanationFeedbackInput = z.infer<typeof explanationFeedbackSchema.body>;
