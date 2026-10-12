import { z } from 'zod';
import { AI_FEATURES, AI_INTERACTION_STATUSES } from '../../config/constants.js';
import { dateOnly, paginationQuery } from '../../utils/zod.js';

/** Clinic dates; default range: the last 30 days, today included. `from` ≤ `to`. */
const range = {
  from: dateOnly.optional(),
  to: dateOnly.optional(),
};
const ordered = (q: { from?: string; to?: string }) => !q.from || !q.to || q.from <= q.to;

/** GET /ai/interactions (admin). */
export const listInteractionsSchema = {
  query: z
    .object({
      ...range,
      ...paginationQuery,
      feature: z.enum(AI_FEATURES).optional(),
      status: z.enum(AI_INTERACTION_STATUSES).optional(),
      model: z.string().trim().min(1).max(100).optional(),
    })
    .refine(ordered, { message: '`from` must not be after `to`', path: ['from'] }),
};

/** GET /ai/interactions/summary (admin). */
export const interactionSummarySchema = {
  query: z
    .object(range)
    .refine(ordered, { message: '`from` must not be after `to`', path: ['from'] }),
};

export type ListInteractionsQuery = z.infer<typeof listInteractionsSchema.query>;
export type InteractionSummaryQuery = z.infer<typeof interactionSummarySchema.query>;
