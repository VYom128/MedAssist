import { z } from 'zod';
import { TIMELINE_RULES, TIMELINE_TYPES } from '../../config/constants.js';
import { dateOnly, idParams } from '../../utils/zod.js';
import { decodeCursor } from './cursor.js';

/** `?types=appointment,invoice` or repeated `?types=…` → a list of timeline types. */
const typeList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v),
  z.array(z.enum(TIMELINE_TYPES)).min(1).max(TIMELINE_TYPES.length),
);

/**
 * GET /patients/:id/timeline and /patients/me/timeline (spec §8.8, Phase 8): cursor pages –
 * `before` is the `nextCursor` of the previous page; `from`/`to` are clinic dates (inclusive).
 */
const timelineQuery = z
  .object({
    before: z
      .string()
      .trim()
      .transform((v, ctx) => {
        const cursor = decodeCursor(v);
        if (!cursor) {
          ctx.addIssue({ code: 'custom', message: 'Not a valid timeline cursor' });
          return z.NEVER;
        }
        return cursor;
      })
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(TIMELINE_RULES.maxLimit)
      .default(TIMELINE_RULES.defaultLimit),
    types: typeList.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'Must be on or after from',
  });

export const patientTimelineSchema = { params: idParams, query: timelineQuery };
export const myTimelineSchema = { query: timelineQuery };

export type TimelineQuery = z.infer<typeof timelineQuery>;
