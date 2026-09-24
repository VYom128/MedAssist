import { ROLES, type Role } from '../../constants/roles';
import { clinicDate } from '../../utils/dates';
import type { Appointment } from './api';

/** Where a role's appointment pages live (the detail page is /<base>/:id). */
export const appointmentsBase = (role: Role | undefined) =>
  role === ROLES.ADMIN
    ? '/admin/appointments'
    : role === ROLES.DOCTOR
      ? '/doctor/appointments'
      : '/reception/appointments';

export type AppointmentActionKind =
  | 'check-in'
  | 'start'
  | 'complete'
  | 'no-show'
  | 'undo-no-show'
  | 'reschedule'
  | 'cancel'
  | 'priority';

/**
 * The actions a role may take on an appointment in its current status (spec §5.1 table, the
 * server's own checks mirrored so only valid buttons show):
 * - reception: check in (on the day), reschedule, cancel, no-show (once started), undo no-show
 *   (same day), priority;
 * - admin: none – admins can view appointments but not act on them (Phase 4 decision);
 * - doctor (own): start, complete (their calendar is otherwise read-only).
 */
export function actionsFor(
  role: Role | undefined,
  a: Pick<Appointment, 'status' | 'startAt'>,
  now = new Date(),
): AppointmentActionKind[] {
  const today = clinicDate(now);
  const onTheDay = clinicDate(a.startAt) === today;
  const started = new Date(a.startAt) <= now;
  const out: AppointmentActionKind[] = [];
  if (role === ROLES.RECEPTIONIST) {
    if (a.status === 'scheduled') {
      if (onTheDay) out.push('check-in');
      out.push('reschedule', 'priority', 'cancel');
      if (started) out.push('no-show');
    } else if (a.status === 'checked_in') {
      out.push('priority', 'cancel');
    } else if (a.status === 'no_show' && onTheDay) {
      out.push('undo-no-show');
    }
  } else if (role === ROLES.DOCTOR) {
    if (a.status === 'checked_in') out.push('start');
    else if (a.status === 'in_consultation') out.push('complete');
  }
  return out;
}

/**
 * What a patient may do online with their own appointment (spec §8.3): cancel and reschedule
 * only while it is scheduled and more than `minCancelHours` away (rescheduling also needs online
 * booking to be on). Inside the window: "please call the clinic".
 */
export function patientChangeRules(
  a: Pick<Appointment, 'status' | 'startAt'>,
  settings: { minCancelHours: number; allowPatientSelfBooking: boolean } | undefined,
  now = new Date(),
) {
  if (a.status !== 'scheduled' || !settings) {
    return { canCancel: false, canReschedule: false, tooLate: false };
  }
  const tooLate =
    new Date(a.startAt).getTime() - now.getTime() < settings.minCancelHours * 3_600_000;
  return {
    canCancel: !tooLate,
    canReschedule: !tooLate && settings.allowPatientSelfBooking,
    tooLate,
  };
}
