import { z } from 'zod';
import { LEAVE_TYPES } from '../../config/constants.js';
import {
  booleanQuery,
  dateOnly,
  idParams,
  objectId,
  optionalText,
  paginationQuery,
} from '../../utils/zod.js';

const instant = z.iso.datetime({
  offset: true,
  error: 'Use an ISO date-time (e.g. 2026-10-05T03:30:00Z)',
});

/**
 * POST /doctors/:id/leaves – either `{ startAt, endAt }` (ISO instants; the UI converts from clinic
 * time) or `{ date, fullDay: true }` with an optional inclusive `endDate` for several whole days,
 * which the server converts using the clinic timezone.
 */
export const createLeaveSchema = {
  params: idParams,
  body: z
    .strictObject({
      startAt: instant.optional(),
      endAt: instant.optional(),
      date: dateOnly.optional(),
      endDate: dateOnly.optional(),
      fullDay: z.literal(true, { error: 'fullDay must be true when given' }).optional(),
      type: z.enum(LEAVE_TYPES).optional(),
      reason: optionalText(500),
    })
    .superRefine((b, ctx) => {
      const timed = b.startAt !== undefined || b.endAt !== undefined;
      const whole = b.date !== undefined || b.fullDay !== undefined || b.endDate !== undefined;
      if (timed && whole) {
        ctx.addIssue({
          code: 'custom',
          path: [],
          message: 'Send either startAt and endAt, or date with fullDay: true',
        });
        return;
      }
      if (whole) {
        if (!b.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Required' });
        if (!b.fullDay)
          ctx.addIssue({ code: 'custom', path: ['fullDay'], message: 'Must be true' });
        if (b.date && b.endDate && b.endDate < b.date) {
          ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be on or after date' });
        }
        return;
      }
      if (!b.startAt) ctx.addIssue({ code: 'custom', path: ['startAt'], message: 'Required' });
      if (!b.endAt) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Required' });
    }),
};

export const listLeavesSchema = {
  params: idParams,
  query: z
    .object({
      ...paginationQuery,
      /** Clinic dates; default from = today. */
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      includeCancelled: booleanQuery,
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

export const leaveIdSchema = { params: z.object({ id: objectId, leaveId: objectId }) };

export type CreateLeaveInput = z.infer<typeof createLeaveSchema.body>;
export type ListLeavesQuery = z.infer<typeof listLeavesSchema.query>;
