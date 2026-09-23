import { ERROR_CODES, ROLES } from '../config/constants.js';
import { DoctorProfile } from '../modules/doctors/model.js';
import * as doctors from '../modules/doctors/service.js';
import { createDoctorSchema, updateDoctorSchema } from '../modules/doctors/validation.js';
import { DoctorLeave } from '../modules/leaves/model.js';
import { createLeave } from '../modules/leaves/service.js';
import { createLeaveSchema } from '../modules/leaves/validation.js';
import { getSchedule, replaceSchedule } from '../modules/schedules/service.js';
import { replaceScheduleSchema } from '../modules/schedules/validation.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import { ApiError } from '../utils/ApiError.js';
import { addDaysToDate, clinicToday } from '../utils/dates.js';
import { changed, counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import { doctorSeeds, LEAVE_PLAN, type DoctorSeed } from './data/clinic.js';
import { departmentIdsByCode } from './departments.js';
import { demoAccountState, demoPasswordHash } from './users.js';

/** First schedules start this many days back, so Phase 4 can seed past appointments inside them. */
const SCHEDULE_HISTORY_DAYS = 90;

const profileFields = (d: DoctorSeed, department: string) => ({
  department,
  specialization: d.specialization,
  qualifications: d.qualifications,
  registrationNumber: d.registrationNumber,
  experienceYears: d.experienceYears,
  consultationFeePaise: d.consultationFeePaise,
  roomNumber: d.roomNumber,
  bio: d.bio,
  languages: d.languages,
});

const weekDays = (d: DoctorSeed) =>
  Object.entries(d.week).map(([weekday, sessions]) => ({ weekday: Number(weekday), sessions }));

/** Sessions of a version as comparable text (maxWalkIns ignored: it defaults from settings). */
const sessionsKey = (days: { weekday: number; sessions: { start: string; end: string }[] }[]) =>
  JSON.stringify(
    Array.from({ length: 7 }, (_, w) =>
      (days.find((d) => d.weekday === w)?.sessions ?? []).map((s) => `${s.start}-${s.end}`),
    ),
  );

/** Upcoming leave: one full day next week, and a 3-day conference later this month. */
function plannedLeave(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  let start = addDaysToDate(lastDay, -3);
  if (start < addDaysToDate(today, 2)) start = addDaysToDate(today, 14); // too late in the month
  return [
    {
      index: LEAVE_PLAN.fullDayNextWeek,
      body: {
        date: addDaysToDate(today, 7),
        fullDay: true,
        type: 'leave',
        reason: 'Personal leave',
      },
    },
    {
      index: LEAVE_PLAN.conferenceThisMonth,
      body: {
        date: start,
        endDate: addDaysToDate(start, 2),
        fullDay: true,
        type: 'conference',
        reason: 'National orthopaedics conference',
      },
    },
  ];
}

/**
 * 8 doctors with profiles, weekly schedules and 2 upcoming leaves. New doctors go through the
 * doctors service (User + profile in one transaction); existing ones are updated through it.
 * Every seeded doctor gets the demo password and no forced password change.
 */
export async function seedDoctors(): Promise<SeedCounts> {
  const actor = await seedActor();
  const departmentIds = await departmentIdsByCode();
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const passwordHash = await demoPasswordHash();
  const result = { ...counts(), schedules: 0, leaves: 0 };
  const ids: string[] = [];

  for (const d of doctorSeeds()) {
    const fields = profileFields(d, departmentIds.get(d.department)!);
    const user = await User.findOne({ email: d.email }).lean();
    let id: string;
    if (!user) {
      const created = await doctors.createDoctor(
        actor,
        createDoctorSchema.body.parse({
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          phone: d.phone,
          ...fields,
        }),
        SEED_REQUEST,
        { sendWelcome: false },
      );
      id = created.id;
      result.created += 1;
    } else {
      if (user.role !== ROLES.DOCTOR) throw new Error(`${d.email} exists but is not a doctor`);
      id = user._id.toString();
      const profile = await DoctorProfile.findOne({ user: user._id }).lean();
      if (!profile) {
        // Phase 1 seeded doctor accounts without profiles.
        await DoctorProfile.create({
          ...fields,
          user: user._id,
          createdBy: actor.id,
          updatedBy: actor.id,
        });
        result.updated += 1;
      } else {
        const after = await doctors.updateDoctor(
          actor,
          id,
          updateDoctorSchema.body.parse(fields),
          SEED_REQUEST,
        );
        result[changed(profile, after) ? 'updated' : 'unchanged'] += 1;
      }
    }
    const state = demoAccountState(passwordHash);
    await User.updateOne(
      { _id: id },
      {
        $set: { ...state.$set, firstName: d.firstName, lastName: d.lastName, phone: d.phone },
        $unset: state.$unset,
      },
    );
    await User.updateOne(
      { _id: id, emailVerifiedAt: null },
      { $set: { emailVerifiedAt: new Date() } },
    );
    ids.push(id);

    // Weekly schedule: first time from 90 days back; a changed template from today.
    const { current } = await getSchedule(actor, id, SEED_REQUEST);
    if (!current || sessionsKey(current.days) !== sessionsKey(weekDays(d))) {
      const effectiveFrom = current ? today : addDaysToDate(today, -SCHEDULE_HISTORY_DAYS);
      await replaceSchedule(
        actor,
        id,
        replaceScheduleSchema.body.parse({ effectiveFrom, days: weekDays(d) }),
        SEED_REQUEST,
        { allowPastStart: true },
      );
      result.schedules += 1;
    }
  }

  for (const { index, body } of plannedLeave(today)) {
    const doctorId = ids[index]!;
    const hasUpcoming = await DoctorLeave.exists({
      doctor: doctorId,
      type: body.type,
      isCancelled: false,
      endAt: { $gt: new Date() },
    });
    if (hasUpcoming) continue;
    try {
      await createLeave(actor, doctorId, createLeaveSchema.body.parse(body), SEED_REQUEST);
      result.leaves += 1;
    } catch (err) {
      // Overlaps leave someone added by hand: keep theirs.
      if (!(err instanceof ApiError && err.code === ERROR_CODES.CONFLICT)) throw err;
    }
  }
  return result;
}

/** Demo logins of the seeded doctors, for the login table. */
export const doctorLogins = () =>
  doctorSeeds().map((d) => ({
    role: ROLES.DOCTOR,
    email: d.email,
    firstName: d.firstName,
    lastName: d.lastName,
  }));
