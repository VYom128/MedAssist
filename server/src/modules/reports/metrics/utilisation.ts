import { Types } from 'mongoose';
import { User } from '../../users/model.js';
import { Appointment } from '../../appointments/model.js';
import { DoctorProfile } from '../../doctors/model.js';
import { DoctorLeave } from '../../leaves/model.js';
import { getSchedulesForRange } from '../../schedules/service.js';
import { zonedDateTimeToUtc } from '../../../utils/dates.js';
import { inRange, type ClinicRange } from './range.js';

/**
 * Doctor utilisation (spec §14, Phase 10 decision): booked minutes ÷ available minutes in the
 * range. Available = the schedule sessions of every clinic day (the template in effect that
 * day) minus the parts covered by non-cancelled leave; booked = the length of the doctor's
 * active appointments (scheduled, checked in, in consultation, completed) starting in the range.
 * Available minutes come from the schedule templates in code (they are not a collection of
 * intervals); booked minutes are an aggregation.
 */

const ACTIVE = ['scheduled', 'checked_in', 'in_consultation', 'completed'];
const MIN = 60_000;

export interface UtilisationRow {
  doctorId: string;
  doctorName: string;
  availableMinutes: number;
  bookedMinutes: number;
  utilisation: number | null;
}

/** Minutes of [a0, a1) not covered by any of `cuts`. */
function minutesOutside(a0: number, a1: number, cuts: readonly [number, number][]): number {
  let covered = 0;
  const overlaps = cuts
    .map(([c0, c1]) => [Math.max(a0, c0), Math.min(a1, c1)] as const)
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  let cursor = a0;
  for (const [s, e] of overlaps) {
    const from = Math.max(s, cursor);
    if (e > from) {
      covered += e - from;
      cursor = e;
    }
  }
  return Math.round((a1 - a0 - covered) / MIN);
}

async function availableMinutes(doctorId: string, r: ClinicRange): Promise<number> {
  const [schedules, leaves] = await Promise.all([
    getSchedulesForRange(doctorId, r.from, r.to),
    DoctorLeave.find({
      doctor: doctorId,
      isCancelled: false,
      startAt: { $lt: r.end },
      endAt: { $gt: r.start },
    })
      .select('startAt endAt')
      .lean(),
  ]);
  const cuts = leaves.map((l) => [l.startAt.getTime(), l.endAt.getTime()] as [number, number]);
  let total = 0;
  for (const [date, day] of schedules) {
    for (const s of day?.sessions ?? []) {
      const a0 = zonedDateTimeToUtc(date, s.start, r.timezone).getTime();
      const a1 = zonedDateTimeToUtc(date, s.end, r.timezone).getTime();
      if (a1 > a0) total += minutesOutside(a0, a1, cuts);
    }
  }
  return total;
}

/** Utilisation per active doctor (or only `doctorIds`), sorted by name. */
export async function doctorUtilisation(
  r: ClinicRange,
  doctorIds?: readonly string[],
): Promise<UtilisationRow[]> {
  const profiles = await DoctorProfile.find(
    doctorIds ? { user: { $in: doctorIds.map((id) => new Types.ObjectId(id)) } } : {},
  )
    .select('user')
    .lean();
  const userIds = profiles.map((p) => p.user);
  const users = await User.find({
    _id: { $in: userIds },
    ...(doctorIds ? {} : { isActive: true }),
  })
    .select('firstName lastName')
    .lean();
  const booked = await Appointment.aggregate<{ _id: Types.ObjectId; minutes: number }>([
    {
      $match: {
        ...inRange('startAt', r),
        doctor: { $in: users.map((u) => u._id) },
        status: { $in: ACTIVE },
      },
    },
    {
      $group: {
        _id: '$doctor',
        minutes: { $sum: { $divide: [{ $subtract: ['$endAt', '$startAt'] }, MIN] } },
      },
    },
  ]);
  const bookedBy = new Map(booked.map((b) => [b._id.toString(), Math.round(b.minutes)]));
  const rows = await Promise.all(
    users.map(async (u) => {
      const id = u._id.toString();
      const available = await availableMinutes(id, r);
      const bookedMinutes = bookedBy.get(id) ?? 0;
      return {
        doctorId: id,
        doctorName: `Dr ${u.firstName} ${u.lastName}`,
        availableMinutes: available,
        bookedMinutes,
        utilisation:
          available > 0 ? Math.round((bookedMinutes / available) * 10_000) / 10_000 : null,
      };
    }),
  );
  return rows.sort((a, b) => a.doctorName.localeCompare(b.doctorName));
}
