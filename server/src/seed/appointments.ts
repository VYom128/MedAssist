import { faker } from '@faker-js/faker';
import type { Types } from 'mongoose';
import { APPOINTMENT_STATUSES, ROLES, tokenCounterKey } from '../config/constants.js';
import {
  bookAppointment,
  insertAppointmentForSeed,
  type SeedAppointmentInput,
} from '../modules/appointments/booking.service.js';
import { Appointment } from '../modules/appointments/model.js';
import { slotGrid, type Slot, type TimeRange } from '../modules/appointments/slots.js';
import { workingSchedule } from '../modules/appointments/slots.service.js';
import { bookAppointmentSchema } from '../modules/appointments/validation.js';
import { Department } from '../modules/departments/model.js';
import { DoctorProfile } from '../modules/doctors/model.js';
import { DoctorLeave } from '../modules/leaves/model.js';
import { Patient } from '../modules/patients/model.js';
import { getSchedulesForRange } from '../modules/schedules/service.js';
import { Service } from '../modules/services/model.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import { ensureSequenceAtLeast } from '../services/counter.service.js';
import { ApiError } from '../utils/ApiError.js';
import { addDaysToDate, clinicToday, startOfClinicDay, toClinicDate } from '../utils/dates.js';
import { logger } from '../utils/logger.js';
import { counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import { doctorSeeds } from './data/clinic.js';
import {
  APPOINTMENT_FAKER_SEED,
  CANCELLATION_REASONS,
  FOLLOW_UP_REASONS,
  FUTURE_DAYS,
  FUTURE_TARGET,
  PAST_DAYS,
  PAST_OUTCOMES,
  PAST_TARGET,
  REASONS,
  TODAY_PLAN,
} from './data/appointments.js';
import { patientLogins } from './patients.js';

/**
 * Appointments (spec §15.3), after the doctors and patients seeders:
 * - the past 60 days: completed visits (with check-in/consultation times and tokens), follow-ups
 *   linked to an earlier visit, cancellations and no-shows – inserted through the seed-only
 *   `insertAppointmentForSeed`, which runs the booking checks but allows past dates;
 * - today: a live queue for up to three doctors with a session today (completed, one with the
 *   doctor, patients waiting incl. an emergency, a walk-in) plus bookings later today;
 * - the next 14 days: bookings through the normal booking service, including two for patient1.
 * Only inside each doctor's schedule, never during leave. Idempotent: the history and the
 * upcoming bookings are created once (skipped when any past appointment exists), today's queue
 * once per clinic day. `--reset` clears appointments and counters (tokens included).
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const QUEUE_STATUSES = ['checked_in', 'in_consultation', 'completed'] as const;

interface ServiceInfo {
  id: string;
  minutes: number;
}
interface DoctorInfo {
  id: string;
  dept: string;
  slotMinutes: number;
  consult: ServiceInfo;
  followUp: ServiceInfo;
}
interface Candidate {
  doctor: DoctorInfo;
  date: string;
  slot: Slot;
}
interface PatientInfo {
  id: string;
}

/** What is booked so far, so picks never clash (the booking checks run again on insert). */
class Occupancy {
  private doctors = new Map<string, TimeRange[]>();
  private patients = new Map<string, { doctor: string; date: string; range: TimeRange }[]>();

  private static overlaps = (a: TimeRange, b: TimeRange) =>
    a.startAt < b.endAt && a.endAt > b.startAt;

  doctorFree(doctor: string, range: TimeRange) {
    return !(this.doctors.get(doctor) ?? []).some((r) => Occupancy.overlaps(r, range));
  }

  patientFree(patient: string, doctor: string, date: string, range: TimeRange) {
    return !(this.patients.get(patient) ?? []).some(
      (b) => Occupancy.overlaps(b.range, range) || (b.doctor === doctor && b.date === date),
    );
  }

  reserve(doctor: string, patient: string | null, date: string, range: TimeRange) {
    this.doctors.set(doctor, [...(this.doctors.get(doctor) ?? []), range]);
    if (patient) {
      this.patients.set(patient, [...(this.patients.get(patient) ?? []), { doctor, date, range }]);
    }
  }
}

const minutesBefore = (d: Date, m: number) => new Date(d.getTime() - m * MIN);
const minutesAfter = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const rangeOf = (startAt: Date, minutes: number): TimeRange => ({
  startAt,
  endAt: minutesAfter(startAt, minutes),
});

async function loadDoctors(defaultSlot: number): Promise<DoctorInfo[]> {
  const departments = new Map(
    (await Department.find().select('code').lean()).map((d) => [d._id.toString(), d.code]),
  );
  const services = new Map(
    (await Service.find({ isActive: true }).select('code durationMinutes').lean()).map((s) => [
      s.code,
      { id: s._id.toString(), minutes: s.durationMinutes },
    ]),
  );
  const result: DoctorInfo[] = [];
  for (const seed of doctorSeeds()) {
    const user = await User.findOne({ email: seed.email, isActive: true }).select('_id').lean();
    const profile = user ? await DoctorProfile.findOne({ user: user._id }).lean() : null;
    if (!user || !profile || !profile.isAcceptingAppointments) continue;
    const dept = departments.get(profile.department.toString()) ?? 'GEN';
    const consult = services.get(`CONS-${dept}`);
    if (!consult) continue;
    result.push({
      id: user._id.toString(),
      dept,
      slotMinutes: profile.slotMinutes ?? defaultSlot,
      consult,
      followUp: services.get(`FUP-${dept}`) ?? consult,
    });
  }
  return result;
}

export async function seedAppointments(): Promise<SeedCounts> {
  faker.seed(APPOINTMENT_FAKER_SEED);
  const reception = await seedActor('reception1@medassist.dev', ROLES.RECEPTIONIST);
  const settings = await getSettings();
  const { timezone } = settings;
  const now = new Date();
  const today = clinicToday(timezone, now);
  const todayStart = startOfClinicDay(today, timezone);
  const from = addDaysToDate(today, -PAST_DAYS);
  const to = addDaysToDate(today, FUTURE_DAYS);

  const result: SeedCounts & { skipped: number } = { ...counts(), skipped: 0 };
  result.unchanged = await Appointment.countDocuments();
  const doctors = await loadDoctors(settings.appointment!.defaultSlotMinutes);
  const patients: PatientInfo[] = (
    await Patient.find({ isActive: true }).sort({ mrn: 1 }).select('_id').lean()
  ).map((p) => ({ id: p._id.toString() }));
  const patient1Email = patientLogins()[0]!.email;
  const patient1 = (await User.findOne({ email: patient1Email }).select('patient').lean())?.patient;
  if (doctors.length === 0 || patients.length === 0) return result;

  // Existing bookings count as occupied (a second run on a later day, bookings made by hand).
  const occupancy = new Occupancy();
  const existing = await Appointment.find({
    status: { $nin: ['cancelled', 'no_show'] },
    startAt: { $gte: startOfClinicDay(from, timezone) },
  })
    .select('doctor patient startAt endAt')
    .lean();
  for (const a of existing) {
    occupancy.reserve(
      a.doctor.toString(),
      a.patient.toString(),
      toClinicDate(a.startAt, timezone),
      a,
    );
  }

  // Free grid slots per doctor and day: inside the schedule, on clinic working days, not on leave.
  const leaves = await DoctorLeave.find({
    isCancelled: false,
    startAt: { $lt: startOfClinicDay(addDaysToDate(to, 1), timezone) },
    endAt: { $gt: startOfClinicDay(from, timezone) },
  }).lean();
  const candidates = {
    past: [] as Candidate[],
    today: new Map<string, Slot[]>(),
    future: [] as Candidate[],
  };
  for (const doctor of doctors) {
    const schedules = await getSchedulesForRange(doctor.id, from, to);
    const doctorLeaves = leaves.filter((l) => l.doctor.toString() === doctor.id);
    for (let date = from; date <= to; date = addDaysToDate(date, 1)) {
      const slots = slotGrid({
        date,
        schedule: workingSchedule(settings, date, schedules.get(date) ?? null),
        slotMinutes: doctor.slotMinutes,
        serviceMinutes: doctor.consult.minutes,
        timezone,
      }).filter((s) => !doctorLeaves.some((l) => l.startAt < s.endAt && l.endAt > s.startAt));
      if (date < today) candidates.past.push(...slots.map((slot) => ({ doctor, date, slot })));
      else if (date === today) candidates.today.set(doctor.id, slots);
      else {
        candidates.future.push(
          ...slots
            .filter((s) => s.startAt > minutesAfter(now, 60))
            .map((slot) => ({ doctor, date, slot })),
        );
      }
    }
  }

  const insert = async (input: SeedAppointmentInput) => {
    try {
      const created = await insertAppointmentForSeed(reception, input, SEED_REQUEST);
      result.created += 1;
      return created;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      result.skipped += 1;
      logger.warn({ code: err.code, startAt: input.startAt }, 'Seed appointment skipped');
      return null;
    }
  };
  const book = async (patientId: string, c: Candidate) => {
    try {
      await bookAppointment(
        reception,
        bookAppointmentSchema.body.parse({
          patientId,
          doctorId: c.doctor.id,
          serviceId: c.doctor.consult.id,
          startAt: c.slot.startAt.toISOString(),
          reason: faker.helpers.arrayElement(REASONS[c.doctor.dept] ?? REASONS.GEN!),
        }),
        SEED_REQUEST,
        { notify: false },
      );
      result.created += 1;
      occupancy.reserve(c.doctor.id, patientId, c.date, c.slot);
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      return false;
    }
  };
  /** A random patient free for this doctor, day and time. */
  const freePatient = (
    doctor: string,
    date: string,
    range: TimeRange,
    exclude = new Set<string>(),
  ) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const p = faker.helpers.arrayElement(patients);
      if (!exclude.has(p.id) && occupancy.patientFree(p.id, doctor, date, range)) return p.id;
    }
    return null;
  };

  const hasHistory = Boolean(await Appointment.exists({ startAt: { $lt: todayStart } }));
  if (!hasHistory) {
    await seedPast(candidates.past);
    await seedFuture(candidates.future);
  }
  const queueToday = await Appointment.exists({
    status: { $in: QUEUE_STATUSES },
    startAt: { $gte: todayStart, $lt: startOfClinicDay(addDaysToDate(today, 1), timezone) },
  });
  if (!queueToday) await seedToday();

  const byStatus = await Appointment.aggregate<{ _id: string; n: number }>([
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  for (const status of APPOINTMENT_STATUSES) {
    result[status] = byStatus.find((s) => s._id === status)?.n ?? 0;
  }
  return result;

  // ---- The past 60 days --------------------------------------------------------------------

  async function seedPast(pool: Candidate[]) {
    const picks: Candidate[] = [];
    for (const c of faker.helpers.shuffle(pool)) {
      if (picks.length >= PAST_TARGET) break;
      if (!occupancy.doctorFree(c.doctor.id, c.slot)) continue;
      occupancy.reserve(c.doctor.id, null, c.date, c.slot);
      picks.push(c);
    }
    picks.sort((a, b) => a.slot.startAt.getTime() - b.slot.startAt.getTime());

    const tokens = new Map<string, number>();
    const lastFinished = new Map<string, Date>();
    const completedVisits: {
      id: Types.ObjectId;
      patient: string;
      doctor: string;
      startAt: Date;
    }[] = [];

    for (const c of picks) {
      const roll = faker.number.float({ min: 0, max: 1 });
      let followUp: (typeof completedVisits)[number] | undefined;
      if (roll >= PAST_OUTCOMES.noShow) {
        const earlier = completedVisits.filter(
          (v) =>
            v.doctor === c.doctor.id &&
            v.startAt.getTime() <= c.slot.startAt.getTime() - 7 * DAY &&
            occupancy.patientFree(v.patient, c.doctor.id, c.date, c.slot),
        );
        if (earlier.length > 0) followUp = faker.helpers.arrayElement(earlier);
      }
      const service = followUp ? c.doctor.followUp : c.doctor.consult;
      const range = rangeOf(c.slot.startAt, service.minutes);
      const patient = followUp?.patient ?? freePatient(c.doctor.id, c.date, range);
      if (!patient) continue;

      const bookedAt = minutesBefore(
        c.slot.startAt,
        faker.number.int({ min: 2, max: 12 }) * 24 * 60,
      );
      const booked = { status: 'scheduled', at: bookedAt, by: reception.id };
      const base = {
        patientId: patient,
        doctorId: c.doctor.id,
        serviceId: service.id,
        startAt: c.slot.startAt,
        source: 'reception' as const,
      };
      let input: SeedAppointmentInput;
      if (roll < PAST_OUTCOMES.completed || followUp || roll >= PAST_OUTCOMES.noShow) {
        const key = `${c.doctor.id}|${c.date}`;
        const token = (tokens.get(key) ?? 0) + 1;
        tokens.set(key, token);
        const checkedInAt = minutesBefore(c.slot.startAt, faker.number.int({ min: 5, max: 25 }));
        const earliest = minutesAfter(c.slot.startAt, faker.number.int({ min: 0, max: 10 }));
        const previous = lastFinished.get(key);
        const startedAt = previous && previous > earliest ? minutesAfter(previous, 1) : earliest;
        const completedAt = minutesAfter(startedAt, faker.number.int({ min: 8, max: 18 }));
        lastFinished.set(key, completedAt);
        input = {
          ...base,
          type: followUp ? 'follow_up' : 'new',
          reason: followUp
            ? faker.helpers.arrayElement(FOLLOW_UP_REASONS)
            : faker.helpers.arrayElement(REASONS[c.doctor.dept] ?? REASONS.GEN!),
          followUpOf: followUp?.id,
          status: 'completed',
          queue: { tokenNumber: token, checkedInAt, calledAt: startedAt, startedAt, completedAt },
          statusHistory: [
            booked,
            { status: 'checked_in', at: checkedInAt, by: reception.id },
            { status: 'in_consultation', at: startedAt, by: c.doctor.id },
            { status: 'completed', at: completedAt, by: c.doctor.id },
          ],
        };
      } else if (roll < PAST_OUTCOMES.cancelled) {
        const reason = faker.helpers.arrayElement(CANCELLATION_REASONS);
        const at = minutesBefore(c.slot.startAt, faker.number.int({ min: 2, max: 40 }) * 60);
        input = {
          ...base,
          type: 'new',
          reason: faker.helpers.arrayElement(REASONS[c.doctor.dept] ?? REASONS.GEN!),
          status: 'cancelled',
          cancellation: { by: reception.id, byRole: ROLES.RECEPTIONIST, at, reason },
          statusHistory: [booked, { status: 'cancelled', at, by: reception.id, note: reason }],
        };
      } else {
        input = {
          ...base,
          type: 'new',
          reason: faker.helpers.arrayElement(REASONS[c.doctor.dept] ?? REASONS.GEN!),
          status: 'no_show',
          statusHistory: [
            booked,
            {
              status: 'no_show',
              at: minutesAfter(range.endAt, 30),
              by: null,
              note: 'Not checked in (automatic)',
            },
          ],
        };
      }
      const created = await insert(input);
      if (!created) continue;
      occupancy.reserve(c.doctor.id, patient, c.date, range);
      if (created.status === 'completed' && !followUp) {
        completedVisits.push({
          id: created._id,
          patient,
          doctor: c.doctor.id,
          startAt: created.startAt,
        });
      }
    }
  }

  // ---- The next 14 days (normal booking service) -------------------------------------------

  async function seedFuture(pool: Candidate[]) {
    // patient1 gets two upcoming bookings with different doctors (the patient portal demo).
    if (patient1) {
      for (const doctor of [doctors[0], doctors[4] ?? doctors[1]]) {
        const c = pool.find(
          (x) =>
            x.doctor === doctor &&
            occupancy.doctorFree(x.doctor.id, x.slot) &&
            occupancy.patientFree(patient1.toString(), x.doctor.id, x.date, x.slot),
        );
        if (c) await book(patient1.toString(), c);
      }
    }
    let booked = 0;
    for (const c of faker.helpers.shuffle(pool)) {
      if (booked >= FUTURE_TARGET) break;
      if (!occupancy.doctorFree(c.doctor.id, c.slot)) continue;
      const patient = freePatient(c.doctor.id, c.date, c.slot);
      if (patient && (await book(patient, c))) booked += 1;
    }
  }

  // ---- Today's live queue ------------------------------------------------------------------

  async function seedToday() {
    const working = doctors.filter((d) => (candidates.today.get(d.id) ?? []).length > 0);
    if (working.length === 0) {
      logger.info(`No doctor works today (${today}): no live queue seeded`);
      return;
    }
    const usedToday = new Set<string>();
    for (const [index, doctor] of working.slice(0, TODAY_PLAN.length).entries()) {
      const plan = TODAY_PLAN[index]!;
      const slots = (candidates.today.get(doctor.id) ?? []).filter((s) =>
        occupancy.doctorFree(doctor.id, s),
      );
      const reason = () => faker.helpers.arrayElement(REASONS[doctor.dept] ?? REASONS.GEN!);

      // Check-in / consultation times are anchored at "now", oldest first.
      const queue: {
        status: SeedAppointmentInput['status'];
        checkedInAt: Date;
        startedAt?: Date;
        completedAt?: Date;
        priority?: 'emergency';
        walkIn?: boolean;
      }[] = [];
      for (let i = 0; i < plan.completed; i += 1) {
        const startedAt = minutesBefore(now, 125 - 30 * i);
        queue.push({
          status: 'completed',
          checkedInAt: minutesBefore(startedAt, 25),
          startedAt,
          completedAt: minutesAfter(startedAt, 20),
        });
      }
      for (let i = 0; i < plan.inConsultation; i += 1) {
        queue.push({
          status: 'in_consultation',
          checkedInAt: minutesBefore(now, 50),
          startedAt: minutesBefore(now, 12),
        });
      }
      for (let i = 0; i < plan.waiting; i += 1) {
        queue.push({
          status: 'checked_in',
          checkedInAt: minutesBefore(now, 40 - 8 * i),
          ...(i === 1 ? { priority: 'emergency' as const } : {}),
        });
      }
      for (let i = 0; i < plan.walkIns; i += 1) {
        queue.push({ status: 'checked_in', checkedInAt: minutesBefore(now, 5), walkIn: true });
      }

      let token = 0;
      for (const [i, q] of queue.entries()) {
        const slot = slots.find((s) => occupancy.doctorFree(doctor.id, s));
        if (!slot) break;
        occupancy.reserve(doctor.id, null, today, slot);
        // patient1 waits in the first doctor's queue (my-position demo in the portal).
        const wantsPatient1 =
          index === 0 && q.status === 'checked_in' && !q.walkIn && i === queue.length - 2;
        const patient =
          wantsPatient1 &&
          patient1 &&
          occupancy.patientFree(patient1.toString(), doctor.id, today, slot)
            ? patient1.toString()
            : freePatient(doctor.id, today, slot, usedToday);
        if (!patient) continue;
        token += 1;
        const history: SeedAppointmentInput['statusHistory'] = q.walkIn
          ? [{ status: 'checked_in', at: q.checkedInAt, by: reception.id, note: 'Walk-in' }]
          : [
              {
                status: 'scheduled',
                at: minutesBefore(q.checkedInAt, 3 * 24 * 60),
                by: reception.id,
              },
              { status: 'checked_in', at: q.checkedInAt, by: reception.id },
            ];
        if (q.startedAt)
          history.push({ status: 'in_consultation', at: q.startedAt, by: doctor.id });
        if (q.completedAt) history.push({ status: 'completed', at: q.completedAt, by: doctor.id });
        const created = await insert({
          patientId: patient,
          doctorId: doctor.id,
          serviceId: doctor.consult.id,
          startAt: slot.startAt,
          type: q.walkIn ? 'walk_in' : 'new',
          source: q.walkIn ? 'walk_in' : 'reception',
          reason: reason(),
          priority: q.priority ?? 'normal',
          status: q.status,
          queue: {
            tokenNumber: token,
            checkedInAt: q.checkedInAt,
            ...(q.startedAt ? { calledAt: q.startedAt, startedAt: q.startedAt } : {}),
            ...(q.completedAt ? { completedAt: q.completedAt } : {}),
          },
          statusHistory: history,
        });
        if (created) {
          usedToday.add(patient);
          occupancy.reserve(doctor.id, patient, today, slot);
        }
      }
      // The next check-in continues after the seeded tokens.
      await ensureSequenceAtLeast(tokenCounterKey(doctor.id, today), token);

      // Bookings later today, through the booking service.
      const later = slots.filter(
        (s) => s.startAt > minutesAfter(now, 20) && occupancy.doctorFree(doctor.id, s),
      );
      let booked = 0;
      for (const slot of later) {
        if (booked >= plan.laterToday) break;
        const patient = freePatient(doctor.id, today, slot, usedToday);
        if (patient && (await book(patient, { doctor, date: today, slot }))) {
          usedToday.add(patient);
          booked += 1;
        }
      }
    }
  }
}
