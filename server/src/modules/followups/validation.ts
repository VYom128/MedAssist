import { z } from 'zod';
import {
  FOLLOWUP_MESSAGE_VISIBILITIES,
  FOLLOWUP_REQUEST_STATUSES,
  FOLLOWUP_REQUEST_TYPES,
  FOLLOWUP_RULES,
} from '../../config/constants.js';
import { calendarDate } from '../../utils/dates.js';
import { dateOnly, idParams, objectId, paginationQuery } from '../../utils/zod.js';

const text = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(FOLLOWUP_RULES.messageMax, `At most ${FOLLOWUP_RULES.messageMax} characters`);

const reason = z
  .string()
  .trim()
  .min(FOLLOWUP_RULES.reasonMin, `At least ${FOLLOWUP_RULES.reasonMin} characters`)
  .max(FOLLOWUP_RULES.reasonMax, `At most ${FOLLOWUP_RULES.reasonMax} characters`);

/** An ISO instant with offset ('2026-10-05T03:30:00Z'); the client converts from clinic time. */
const instant = z.iso
  .datetime({ offset: true, error: 'Use an ISO date-time (e.g. 2026-10-05T03:30:00Z)' })
  .transform((v) => new Date(v));

/** `?status=open,in_review` or repeated `?status=…` → a list. */
const statusList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v),
  z.array(z.enum(FOLLOWUP_REQUEST_STATUSES)).min(1).max(FOLLOWUP_REQUEST_STATUSES.length),
);

/** POST /follow-up-requests (patient). */
export const createFollowupSchema = {
  body: z.strictObject({
    relatedAppointmentId: objectId.optional(),
    type: z.enum(FOLLOWUP_REQUEST_TYPES),
    message: text,
    preferredDate: dateOnly.transform(calendarDate).optional(),
    attachmentIds: z
      .array(objectId)
      .max(FOLLOWUP_RULES.maxAttachments, `At most ${FOLLOWUP_RULES.maxAttachments} files`)
      .refine((ids) => new Set(ids).size === ids.length, 'Each file once')
      .optional(),
  }),
};

/** GET /follow-up-requests. `from`/`to` are clinic dates of creation (inclusive). */
export const listFollowupsSchema = {
  query: z
    .object({
      ...paginationQuery,
      status: statusList.optional(),
      type: z.enum(FOLLOWUP_REQUEST_TYPES).optional(),
      assignedDoctor: objectId.optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      /** A request number ('FUR-2026-000012') or the patient's MRN/phone/name. */
      q: z.string().trim().min(1).max(100).optional(),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

export const followupIdSchema = { params: idParams };

/** POST /follow-up-requests/:id/messages – patients may only post 'all'. */
export const postMessageSchema = {
  params: idParams,
  body: z.strictObject({
    text,
    visibility: z.enum(FOLLOWUP_MESSAGE_VISIBILITIES).default('all'),
  }),
};

/** POST /follow-up-requests/:id/assign (reception). */
export const assignFollowupSchema = {
  params: idParams,
  body: z.strictObject({ doctorId: objectId }),
};

/** POST /follow-up-requests/:id/schedule – books through the normal booking service. */
export const scheduleFollowupSchema = {
  params: idParams,
  body: z.strictObject({
    startAt: instant,
    serviceId: objectId,
    /** Reception may choose another doctor; defaults to the assigned doctor. */
    doctorId: objectId.optional(),
  }),
};

/** POST /follow-up-requests/:id/close | /reject */
export const reasonSchema = { params: idParams, body: z.strictObject({ reason }) };

export type CreateFollowupInput = z.infer<typeof createFollowupSchema.body>;
export type ListFollowupsQuery = z.infer<typeof listFollowupsSchema.query>;
export type PostMessageInput = z.infer<typeof postMessageSchema.body>;
export type ScheduleFollowupInput = z.infer<typeof scheduleFollowupSchema.body>;
