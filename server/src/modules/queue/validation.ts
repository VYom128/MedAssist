import { z } from 'zod';
import { APPOINTMENT_PRIORITIES, APPOINTMENT_RULES } from '../../config/constants.js';
import { dateOnly, objectId, optionalText } from '../../utils/zod.js';

/** GET /queue?doctor&date – `doctor` defaults to the calling doctor; `date` to today. */
export const queueSchema = {
  query: z.object({ doctor: objectId.optional(), date: dateOnly.optional() }),
};

/** POST /queue/:appointmentId/priority */
export const prioritySchema = {
  params: z.object({ appointmentId: objectId }),
  body: z.strictObject({
    priority: z.enum(APPOINTMENT_PRIORITIES),
    reason: optionalText(APPOINTMENT_RULES.reasonMaxLength),
  }),
};

/** GET /queue/board?key= */
export const boardSchema = {
  query: z.object({ key: z.string().max(200).optional() }),
};

export type QueueQuery = z.infer<typeof queueSchema.query>;
export type PriorityInput = z.infer<typeof prioritySchema.body>;
