import type { Types } from 'mongoose';
import { addDaysToDate, calendarDateString, toClinicDate } from '../../utils/dates.js';

/**
 * Planned follow-ups (spec §4.10, Phase 8): when a signed note's follow-up is due, and whether
 * the patient has booked it already. Shared by GET /patients/me/follow-ups-due and the
 * follow-up reminder job.
 */

interface PlannedNote {
  _id: Types.ObjectId;
  appointment: Types.ObjectId;
  doctor: Types.ObjectId | { _id: Types.ObjectId };
  visitAt: Date;
  signedAt?: Date | null;
  followUp?: {
    required?: boolean | null;
    afterDays?: number | null;
    date?: Date | null;
  } | null;
}

/**
 * The clinic date the follow-up is due ('YYYY-MM-DD'): the planned date, else the signing day +
 * `afterDays`; null when no follow-up is planned (or no time was given).
 */
export function followUpDueDate(e: PlannedNote, timezone: string): string | null {
  const f = e.followUp;
  if (!f?.required) return null;
  if (f.date) return calendarDateString(f.date);
  if (f.afterDays && e.signedAt) {
    return addDaysToDate(toClinicDate(e.signedAt, timezone), f.afterDays);
  }
  return null;
}

/** Appointment statuses that do not count as "booked" (the patient never came or cancelled). */
export const NOT_BOOKED_STATUSES = ['cancelled', 'no_show'] as const;

/** The appointment fields `isFollowUpBooked` looks at. */
export interface LaterAppointment {
  _id: Types.ObjectId;
  doctor: Types.ObjectId;
  startAt: Date;
  followUpOf?: Types.ObjectId | null;
}

const idOf = (ref: Types.ObjectId | { _id: Types.ObjectId }) =>
  ('_id' in ref ? ref._id : ref).toString();

/**
 * Whether the follow-up of note `e` is booked: an appointment (not cancelled or missed) linked
 * to the visit with `followUpOf`, or any later appointment with the same doctor. `appointments`
 * are the patient's appointments in those statuses.
 */
export function isFollowUpBooked(e: PlannedNote, appointments: readonly LaterAppointment[]) {
  const visit = e.appointment.toString();
  const doctor = idOf(e.doctor);
  return appointments.some(
    (a) =>
      a._id.toString() !== visit &&
      (a.followUpOf?.toString() === visit ||
        (a.doctor.toString() === doctor && a.startAt.getTime() > e.visitAt.getTime())),
  );
}
