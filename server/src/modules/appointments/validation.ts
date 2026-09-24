import { z } from 'zod';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_RULES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
} from '../../config/constants.js';
import { daysBetween } from '../../utils/dates.js';
import {
  dateOnly,
  idParams,
  objectId,
  optionalText,
  paginationQuery,
  sortQuery,
} from '../../utils/zod.js';

const { reasonMaxLength, maxRangeDays } = APPOINTMENT_RULES;

/** An ISO instant with offset ('2026-10-05T03:30:00Z'); the client converts from clinic time. */
const instant = z.iso
  .datetime({ offset: true, error: 'Use an ISO date-time (e.g. 2026-10-05T03:30:00Z)' })
  .transform((v) => new Date(v));

/** Free-text reason; staff must give one to reschedule or cancel (checked in the service). */
const reason = optionalText(reasonMaxLength);

/** Checks `to` is on or after `from` and the range is at most `maxRangeDays` days. */
function checkRange(q: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (!q.from || !q.to) return;
  const days = daysBetween(q.from, q.to);
  if (days < 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must be on or after from' });
  else if (days >= maxRangeDays) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `At most ${maxRangeDays} days` });
  }
}

/** `?status=scheduled,checked_in` or repeated `?status=…` → an array of statuses. */
const statusList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v),
  z.array(z.enum(APPOINTMENT_STATUSES)).min(1).max(APPOINTMENT_STATUSES.length),
);

/** POST /appointments. Staff send `patientId`; patients book for themselves. */
export const bookAppointmentSchema = {
  body: z
    .strictObject({
      patientId: objectId.optional(),
      doctorId: objectId,
      serviceId: objectId,
      startAt: instant,
      type: z.enum(['new', 'follow_up']).default('new'),
      reason,
      followUpOf: objectId.optional(),
    })
    .refine((b) => !b.followUpOf || b.type === 'follow_up', {
      path: ['followUpOf'],
      message: 'Only for type follow_up',
    }),
};

/** POST /appointments/walk-in (reception): created checked in, now. */
export const walkInSchema = {
  body: z.strictObject({
    patientId: objectId,
    doctorId: objectId,
    serviceId: objectId,
    reason,
    priority: z.enum(APPOINTMENT_PRIORITIES).default('normal'),
  }),
};

/** POST /appointments/:id/reschedule */
export const rescheduleSchema = {
  params: idParams,
  body: z.strictObject({
    startAt: instant,
    doctorId: objectId.optional(),
    serviceId: objectId.optional(),
    reason,
  }),
};

/** POST /appointments/:id/cancel */
export const cancelSchema = {
  params: idParams,
  body: z.strictObject({ reason }).optional().default({ reason: undefined }),
};

/** PATCH /appointments/:id (staff): reason and priority only. */
export const updateAppointmentSchema = {
  params: idParams,
  body: z
    .strictObject({ reason, priority: z.enum(APPOINTMENT_PRIORITIES).optional() })
    .refine((b) => b.reason !== undefined || b.priority !== undefined, {
      message: 'Send reason and/or priority',
    }),
};

export const appointmentIdSchema = { params: idParams };

/** GET /appointments */
export const listAppointmentsSchema = {
  query: z
    .object({
      ...paginationQuery,
      /** Clinic dates. */
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      doctor: objectId.optional(),
      patient: objectId.optional(),
      department: objectId.optional(),
      status: statusList.optional(),
      type: z.enum(APPOINTMENT_TYPES).optional(),
      q: z.string().trim().max(100).optional(),
      sort: sortQuery(['startAt', 'createdAt'], { startAt: 1 }),
    })
    .superRefine(checkRange),
};

/** GET /appointments/calendar */
export const calendarSchema = {
  query: z
    .object({ from: dateOnly, to: dateOnly, doctor: objectId.optional() })
    .superRefine(checkRange),
};

/** GET /doctors/:id/slots */
export const slotsSchema = {
  params: idParams,
  query: z.object({ date: dateOnly, serviceId: objectId.optional() }),
};

/** GET /doctors/:id/availability */
export const availabilitySchema = {
  params: idParams,
  query: z
    .object({ from: dateOnly, to: dateOnly, serviceId: objectId.optional() })
    .superRefine(checkRange),
};

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema.body>;
export type WalkInInput = z.infer<typeof walkInSchema.body>;
export type RescheduleInput = z.infer<typeof rescheduleSchema.body>;
export type CancelInput = z.infer<typeof cancelSchema.body>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema.body>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsSchema.query>;
export type CalendarQuery = z.infer<typeof calendarSchema.query>;
export type SlotsQuery = z.infer<typeof slotsSchema.query>;
export type AvailabilityQuery = z.infer<typeof availabilitySchema.query>;
