import { Types } from 'mongoose';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../../../config/constants.js';
import { Appointment } from '../../appointments/model.js';
import { Department } from '../../departments/model.js';
import { User } from '../../users/model.js';
import { clinicDayKey, inRange, type ClinicRange } from './range.js';

/**
 * Appointment counts (spec §14): appointments whose start lies in the range, by status – and,
 * for the report, per clinic day, doctor or department. Doctor scopes (`doctorId`) count only
 * that doctor's own appointments.
 */

export type StatusCounts = Record<AppointmentStatus, number>;
export const emptyStatusCounts = (): StatusCounts =>
  Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s, 0])) as StatusCounts;

export interface AppointmentScope {
  doctorId?: string;
}

const scopeMatch = (r: ClinicRange, scope: AppointmentScope) => ({
  ...inRange('startAt', r),
  ...(scope.doctorId ? { doctor: new Types.ObjectId(scope.doctorId) } : {}),
});

/** Appointments in the range by status (every status present, 0 when none). */
export async function appointmentsByStatus(
  r: ClinicRange,
  scope: AppointmentScope = {},
): Promise<StatusCounts & { total: number }> {
  const rows = await Appointment.aggregate<{ _id: AppointmentStatus; n: number }>([
    { $match: scopeMatch(r, scope) },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const counts = emptyStatusCounts();
  for (const row of rows) counts[row._id] = row.n;
  return { ...counts, total: rows.reduce((s, x) => s + x.n, 0) };
}

export type AppointmentGroupBy = 'day' | 'doctor' | 'department' | 'status';

export interface AppointmentRow extends StatusCounts {
  key: string;
  label: string;
  total: number;
}

/** Appointments in the range grouped by day, doctor, department or status. */
export async function appointmentsGrouped(
  r: ClinicRange,
  groupBy: AppointmentGroupBy,
  scope: AppointmentScope = {},
): Promise<AppointmentRow[]> {
  const key =
    groupBy === 'day'
      ? clinicDayKey('startAt', r.timezone)
      : groupBy === 'doctor'
        ? '$doctor'
        : groupBy === 'department'
          ? '$department'
          : '$status';
  const rows = await Appointment.aggregate<{
    _id: { key: unknown; status: AppointmentStatus };
    n: number;
  }>([
    { $match: scopeMatch(r, scope) },
    { $group: { _id: { key, status: '$status' }, n: { $sum: 1 } } },
  ]);
  const byKey = new Map<string, AppointmentRow>();
  for (const row of rows) {
    const k = row._id.key === null || row._id.key === undefined ? 'none' : String(row._id.key);
    const entry = byKey.get(k) ?? { key: k, label: k, total: 0, ...emptyStatusCounts() };
    entry[row._id.status] += row.n;
    entry.total += row.n;
    byKey.set(k, entry);
  }
  const result = [...byKey.values()];
  if (groupBy === 'doctor' || groupBy === 'department') {
    const ids = result.filter((x) => Types.ObjectId.isValid(x.key)).map((x) => x.key);
    const names = new Map<string, string>(
      groupBy === 'doctor'
        ? (
            await User.find({ _id: { $in: ids } })
              .select('firstName lastName')
              .lean()
          ).map((u) => [u._id.toString(), `Dr ${u.firstName} ${u.lastName}`])
        : (
            await Department.find({ _id: { $in: ids } })
              .select('name')
              .lean()
          ).map((d) => [d._id.toString(), d.name]),
    );
    for (const x of result) x.label = names.get(x.key) ?? 'Not set';
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * No-show rate (spec §14): no-shows ÷ (completed + no-shows) for appointments that started in
 * the range and before `now` (future ones cannot be either yet). Null without any.
 */
export async function noShowRate(
  r: ClinicRange,
  scope: AppointmentScope = {},
  now = new Date(),
): Promise<{ completed: number; noShow: number; rate: number | null }> {
  const [rows] = await Appointment.aggregate<{ completed: number; noShow: number }>([
    {
      $match: {
        ...scopeMatch(r, scope),
        startAt: { $gte: r.start, $lt: r.end < now ? r.end : now },
        status: { $in: ['completed', 'no_show'] },
      },
    },
    {
      $group: {
        _id: null,
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        noShow: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
      },
    },
  ]);
  const completed = rows?.completed ?? 0;
  const noShow = rows?.noShow ?? 0;
  const den = completed + noShow;
  return { completed, noShow, rate: den > 0 ? Math.round((noShow / den) * 10_000) / 10_000 : null };
}

/** No-show rate per doctor (report rows, sorted by name). */
export async function noShowsByDoctor(r: ClinicRange, now = new Date()) {
  const rows = await Appointment.aggregate<{
    _id: Types.ObjectId;
    completed: number;
    noShow: number;
  }>([
    {
      $match: {
        startAt: { $gte: r.start, $lt: r.end < now ? r.end : now },
        status: { $in: ['completed', 'no_show'] },
      },
    },
    {
      $group: {
        _id: '$doctor',
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        noShow: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
      },
    },
  ]);
  const names = new Map(
    (
      await User.find({ _id: { $in: rows.map((x) => x._id) } })
        .select('firstName lastName')
        .lean()
    ).map((u) => [u._id.toString(), `Dr ${u.firstName} ${u.lastName}`]),
  );
  return rows
    .map((x) => {
      const den = x.completed + x.noShow;
      return {
        key: x._id.toString(),
        label: names.get(x._id.toString()) ?? 'Unknown',
        completed: x.completed,
        noShow: x.noShow,
        rate: den > 0 ? Math.round((x.noShow / den) * 10_000) / 10_000 : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
