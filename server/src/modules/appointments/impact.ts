import type { ClientSession, Types } from 'mongoose';
import { toClinicDate, weekdayOf, zonedDateTimeToUtc } from '../../utils/dates.js';
import { Appointment } from './model.js';

/**
 * Appointments affected by a doctor's leave or a new weekly schedule (spec §4.13, §7.6). Reads
 * inside the caller's transaction, which has taken the doctor's booking lock, so no booking can
 * slip in between the check and the write.
 */

/** Appointments that still need the doctor: to be rescheduled or cancelled by reception. */
const PENDING_STATUSES = ['scheduled', 'checked_in'] as const;
/** Appointments that happened (or are happening): leave cannot be put over them. */
const HELD_STATUSES = ['in_consultation', 'completed'] as const;

interface ImpactRow {
  _id: Types.ObjectId;
  appointmentNumber: string;
  status: string;
  startAt: Date;
  endAt: Date;
  patient: { firstName: string; lastName: string } | null;
}

/** An affected appointment in a leave/schedule response: no patient details beyond a short name. */
export function toAffectedItem(a: ImpactRow) {
  return {
    id: a._id.toString(),
    appointmentNumber: a.appointmentNumber,
    status: a.status,
    startAt: a.startAt,
    endAt: a.endAt,
    patientShortName: a.patient ? `${a.patient.firstName} ${a.patient.lastName.charAt(0)}.` : null,
  };
}

const find = (filter: Record<string, unknown>, session: ClientSession) =>
  Appointment.find(filter)
    .select('appointmentNumber status startAt endAt patient')
    .populate({ path: 'patient', select: 'firstName lastName' })
    .sort({ startAt: 1 })
    .session(session)
    .lean() as unknown as Promise<ImpactRow[]>;

/**
 * For leave `[startAt, endAt)`: `blocking` = appointments in consultation or completed in that
 * period (leave cannot be saved over them); `affected` = scheduled or checked-in ones.
 */
export async function leaveImpact(
  doctorId: string | Types.ObjectId,
  range: { startAt: Date; endAt: Date },
  session: ClientSession,
) {
  const overlap = {
    doctor: doctorId,
    startAt: { $lt: range.endAt },
    endAt: { $gt: range.startAt },
  };
  const [blocking, affected] = await Promise.all([
    find({ ...overlap, status: { $in: HELD_STATUSES } }, session),
    find({ ...overlap, status: { $in: PENDING_STATUSES } }, session),
  ]);
  return { blocking, affected };
}

/**
 * Scheduled or checked-in appointments from `from` on that do not fit inside the new sessions of
 * their weekday (a day off = no sessions).
 */
export async function scheduleImpact(
  doctorId: string | Types.ObjectId,
  from: Date,
  sessionsByWeekday: ReadonlyMap<number, readonly { start: string; end: string }[]>,
  timezone: string,
  session: ClientSession,
) {
  const upcoming = await find(
    { doctor: doctorId, status: { $in: PENDING_STATUSES }, startAt: { $gte: from } },
    session,
  );
  return upcoming.filter((a) => {
    const date = toClinicDate(a.startAt, timezone);
    const sessions = sessionsByWeekday.get(weekdayOf(date)) ?? [];
    return !sessions.some(
      (s) =>
        zonedDateTimeToUtc(date, s.start, timezone) <= a.startAt &&
        a.endAt <= zonedDateTimeToUtc(date, s.end, timezone),
    );
  });
}
