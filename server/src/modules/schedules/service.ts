import type { Types } from 'mongoose';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { assertCanManageDoctor, assertCanViewDoctorSchedule } from '../../policies/doctorAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  addDaysToDate,
  calendarDate,
  calendarDateString,
  clinicToday,
  timeToMinutes,
  WEEKDAY_NAMES,
  weekdayOf,
} from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { withTransaction } from '../../utils/transaction.js';
import { DoctorProfile } from '../doctors/model.js';
import { findDoctor } from '../doctors/service.js';
import { getSettings } from '../settings/service.js';
import { DoctorSchedule } from './model.js';
import { toVersionView, type ScheduleVersion } from './serializer.js';
import type { ReplaceScheduleInput } from './validation.js';

type Id = string | Types.ObjectId;

/** Documents of versions that are in effect on or after `date`, grouped by version, oldest first. */
async function versionsFrom(doctorId: Id, date: string): Promise<ScheduleVersion[]> {
  const day = calendarDate(date);
  const docs = await DoctorSchedule.find({
    doctor: doctorId,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: day } }],
  })
    .sort({ effectiveFrom: 1, weekday: 1 })
    .lean();
  const groups = new Map<number, typeof docs>();
  for (const doc of docs) {
    const key = doc.effectiveFrom.getTime();
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  return [...groups.values()].map(toVersionView);
}

/** The version in effect on `date` ('YYYY-MM-DD'), or null. */
async function versionOn(doctorId: Id, date: string): Promise<ScheduleVersion | null> {
  const [first] = await versionsFrom(doctorId, date);
  return first && first.effectiveFrom <= date ? first : null;
}

/**
 * The doctor's sessions on a clinic date (spec §8.1 step 2). Used by slot generation (Phase 4).
 * @param doctorId The doctor's User id.
 * @param date 'YYYY-MM-DD' in the clinic timezone.
 * @returns the template version in effect that day and that weekday's sessions (empty = day
 *   off), or null when no template covers the date.
 */
export async function getScheduleForDate(doctorId: Id, date: string) {
  const day = calendarDate(date);
  const weekday = weekdayOf(date);
  const doc = await DoctorSchedule.findOne({
    doctor: doctorId,
    weekday,
    effectiveFrom: { $lte: day },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: day } }],
  }).lean();
  if (!doc) return null;
  return {
    effectiveFrom: calendarDateString(doc.effectiveFrom),
    effectiveTo: doc.effectiveTo ? calendarDateString(doc.effectiveTo) : null,
    weekday,
    sessions: doc.sessions.map((s) => ({
      start: s.start,
      end: s.end,
      maxWalkIns: s.maxWalkIns ?? 0,
    })),
  };
}

/** `{ current, upcoming }`: the version in effect today and the next one starting later. */
async function scheduleView(doctorId: Id, today: string) {
  const versions = await versionsFrom(doctorId, today);
  const current = versions.find((v) => v.effectiveFrom <= today) ?? null;
  const upcoming = versions.find((v) => v.effectiveFrom > today) ?? null;
  return { current, upcoming };
}

/** GET /doctors/:id/schedule – admins, receptionists and the doctor themselves. */
export async function getSchedule(user: AuthUser, doctorId: string, meta: RequestMeta) {
  await assertCanViewDoctorSchedule(user, doctorId, meta);
  await findDoctor(doctorId);
  const { timezone } = await getSettings();
  return scheduleView(doctorId, clinicToday(timezone));
}

/**
 * PUT /doctors/:id/schedule – replaces the weekly template from `effectiveFrom` (today or later,
 * clinic timezone). In one transaction: versions starting on or after that date are removed
 * (they never took effect), the version open on that date is closed the day before, and the new
 * version is inserted. Sessions on days that are not clinic working days are saved with a warning.
 * `maxWalkIns` defaults to `settings.appointment.walkInOverbookPerSession`.
 */
export async function replaceSchedule(
  user: AuthUser,
  doctorId: string,
  input: ReplaceScheduleInput,
  meta: RequestMeta,
  /** Seed only (never from the API): lets a template start in the past for demo history. */
  { allowPastStart = false }: { allowPastStart?: boolean } = {},
) {
  await assertCanManageDoctor(user, doctorId, meta);
  const profile = await findDoctor(doctorId);
  const settings = await getSettings();
  const today = clinicToday(settings.timezone);
  if (input.effectiveFrom < today && !allowPastStart) {
    throw ApiError.unprocessable('A new schedule cannot start in the past', [
      { field: 'body.effectiveFrom', message: `Must be ${today} or later` },
    ]);
  }

  const from = calendarDate(input.effectiveFrom);
  const dayBefore = calendarDate(addDaysToDate(input.effectiveFrom, -1));
  const defaultWalkIns = settings.appointment!.walkInOverbookPerSession;
  const sessionsByDay = new Map(
    input.days.map((d) => [
      d.weekday,
      [...d.sessions]
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
        .map((s) => ({ start: s.start, end: s.end, maxWalkIns: s.maxWalkIns ?? defaultWalkIns })),
    ]),
  );
  const docs = Array.from({ length: 7 }, (_, weekday) => ({
    doctor: profile.user._id,
    weekday,
    sessions: sessionsByDay.get(weekday) ?? [],
    effectiveFrom: from,
    effectiveTo: null,
    createdBy: user.id,
    updatedBy: user.id,
  }));

  const before = await versionOn(doctorId, input.effectiveFrom);
  await withTransaction(async (session) => {
    // Serialises schedule writes for this doctor (concurrent ones conflict and retry).
    await DoctorProfile.updateOne({ _id: profile._id }, { $inc: { lockVersion: 1 } }, { session });
    await DoctorSchedule.deleteMany(
      { doctor: doctorId, effectiveFrom: { $gte: from } },
      { session },
    );
    await DoctorSchedule.updateMany(
      {
        doctor: doctorId,
        effectiveFrom: { $lt: from },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: from } }],
      },
      { $set: { effectiveTo: dayBefore, updatedBy: user.id } },
      { session },
    );
    await DoctorSchedule.insertMany(docs, { session });
  });

  const after = toVersionView(docs);
  const workingDays = new Set(settings.workingDays);
  const warnings = after.days
    .filter((d) => d.sessions.length > 0 && !workingDays.has(d.weekday))
    .map((d) => ({
      weekday: d.weekday,
      message: `${WEEKDAY_NAMES[d.weekday]} is not a clinic working day`,
    }));

  await audit.record({
    action: AUDIT_ACTIONS.DOCTOR_SCHEDULE_UPDATE,
    actor: actorOf(user),
    resource: { type: 'doctor', id: doctorId },
    request: meta,
    changes: {
      fields: ['schedule'],
      before: { schedule: before },
      after: { schedule: after },
    },
    metadata: { effectiveFrom: input.effectiveFrom },
  });

  return {
    ...(await scheduleView(doctorId, today)),
    warnings,
    // TODO(Phase 4): future appointments that fall outside the new hours (spec §7.6).
    affectedAppointments: [] as unknown[],
  };
}
