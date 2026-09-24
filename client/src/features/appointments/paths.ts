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
 * - admin: reschedule, cancel, priority while scheduled;
 * - doctor (own): start, complete, cancel.
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
  } else if (role === ROLES.ADMIN) {
    if (a.status === 'scheduled') out.push('reschedule', 'priority', 'cancel');
    else if (a.status === 'checked_in') out.push('cancel');
  } else if (role === ROLES.DOCTOR) {
    if (a.status === 'checked_in') out.push('start', 'cancel');
    else if (a.status === 'in_consultation') out.push('complete');
    else if (a.status === 'scheduled') out.push('cancel');
  }
  return out;
}
