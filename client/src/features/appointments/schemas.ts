import { z } from 'zod';
import { APPOINTMENT_PRIORITIES, APPOINTMENT_REASON_MIN } from '../../constants/catalog';

// Mirrors server/src/modules/appointments/validation.ts (plus the steps of the booking form).

const REASON_MAX = 500;

/** The reception booking form (spec §4.5). */
export const bookingSchema = z
  .object({
    patientId: z.string().min(1, 'Choose a patient'),
    departmentId: z.string(),
    doctorId: z.string().min(1, 'Choose a doctor'),
    serviceId: z.string().min(1, 'Choose a service'),
    date: z.string().min(1, 'Choose a date'),
    startAt: z.string().min(1, 'Choose a time'),
    type: z.enum(['new', 'follow_up']),
    followUpOf: z.string(),
    reason: z.string().trim().max(REASON_MAX, `At most ${REASON_MAX} characters`),
    priority: z.enum(APPOINTMENT_PRIORITIES),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'follow_up' && !v.followUpOf) {
      ctx.addIssue({ code: 'custom', path: ['followUpOf'], message: 'Choose the earlier visit' });
    }
  });

export type BookingFormValues = z.infer<typeof bookingSchema>;

/** A staff reason (reschedule, cancel): the server wants at least 3 characters. */
export const staffReason = z
  .string()
  .trim()
  .min(APPOINTMENT_REASON_MIN, `At least ${APPOINTMENT_REASON_MIN} characters`)
  .max(REASON_MAX, `At most ${REASON_MAX} characters`);
