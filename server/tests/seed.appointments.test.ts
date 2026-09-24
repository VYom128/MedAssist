import { tokenCounterKey } from '../src/config/constants.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Counter } from '../src/modules/counters/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { getScheduleForDate } from '../src/modules/schedules/service.js';
import { User } from '../src/modules/users/model.js';
import { runSeed } from '../src/seed/index.js';
import { patientLogins } from '../src/seed/patients.js';
import {
  addDaysToDate,
  clinicToday,
  startOfClinicDay,
  toClinicDate,
  weekdayOf,
  zonedDateTimeToUtc,
} from '../src/utils/dates.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';

/** Appointment seed data (spec §15.3): realistic, conflict-free, idempotent. */

const TZ = 'Asia/Kolkata';
type Appt = Awaited<ReturnType<typeof loadAll>>[number];
const loadAll = () => Appointment.find().sort({ startAt: 1 }).lean();
const overlap = (a: Appt, b: Appt) => a.startAt < b.endAt && a.endAt > b.startAt;

describe('appointment seed', () => {
  let all: Appt[];
  let summary: Awaited<ReturnType<typeof runSeed>>;
  let emails: ReturnType<typeof captureEmails>;
  const today = clinicToday(TZ);
  const todayStart = startOfClinicDay(today, TZ);
  const tomorrowStart = startOfClinicDay(addDaysToDate(today, 1), TZ);

  beforeAll(async () => {
    await Promise.all([DoctorProfile.init(), DoctorSchedule.init(), Appointment.init()]);
    await resetDb();
    emails = captureEmails();
    summary = await runSeed();
    all = await loadAll();
  }, 120_000);
  afterAll(() => emails.restore());

  it('creates about 300 appointments and reports counts by status', () => {
    expect(all.length).toBeGreaterThanOrEqual(260);
    expect(all.length).toBeLessThanOrEqual(340);
    expect(summary.appointments).toMatchObject({ created: all.length, skipped: 0 });
    const statuses = summary.appointments!;
    expect(
      ['scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']
        .map((s) => statuses[s]!)
        .reduce((a, b) => a + b, 0),
    ).toBe(all.length);
  });

  it('sends no emails', () => {
    expect(emails.sent).toEqual([]);
  });

  it('never double-books a doctor or a patient', () => {
    const active = all.filter((a) => a.isSlotActive);
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length && active[j]!.startAt < active[i]!.endAt; j += 1) {
        expect(
          active[i]!.doctor.equals(active[j]!.doctor) && overlap(active[i]!, active[j]!),
          `${active[i]!.appointmentNumber} / ${active[j]!.appointmentNumber}`,
        ).toBe(false);
      }
    }
    const open = all.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show');
    for (let i = 0; i < open.length; i += 1) {
      for (let j = i + 1; j < open.length && open[j]!.startAt < open[i]!.endAt; j += 1) {
        expect(open[i]!.patient.equals(open[j]!.patient) && overlap(open[i]!, open[j]!)).toBe(
          false,
        );
      }
    }
  });

  it('only inside the doctor’s sessions, on working days, never during leave', async () => {
    const leaves = await DoctorLeave.find({ isCancelled: false }).lean();
    for (const a of all) {
      const date = toClinicDate(a.startAt, TZ);
      expect(weekdayOf(date), a.appointmentNumber).not.toBe(0); // clinic closed on Sunday
      const schedule = await getScheduleForDate(a.doctor, date);
      const inside = schedule!.sessions.some(
        (s) =>
          zonedDateTimeToUtc(date, s.start, TZ) <= a.startAt &&
          a.endAt <= zonedDateTimeToUtc(date, s.end, TZ),
      );
      expect(inside, a.appointmentNumber).toBe(true);
      const onLeave = leaves.some(
        (l) => l.doctor.equals(a.doctor) && l.startAt < a.endAt && l.endAt > a.startAt,
      );
      expect(onLeave, a.appointmentNumber).toBe(false);
    }
  });

  it('spread across the doctors and patients', () => {
    expect(new Set(all.map((a) => a.doctor.toString())).size).toBe(8);
    expect(new Set(all.map((a) => a.patient.toString())).size).toBeGreaterThanOrEqual(50);
  });

  it('the past: mostly completed with visit times and tokens; cancellations; no-shows; follow-ups', () => {
    const past = all.filter((a) => a.startAt < todayStart);
    expect(past.length).toBeGreaterThan(200);
    const share = (s: string) => past.filter((a) => a.status === s).length / past.length;
    expect(share('completed')).toBeGreaterThan(0.75);
    expect(share('cancelled')).toBeGreaterThan(0.05);
    expect(share('cancelled')).toBeLessThan(0.16);
    expect(share('no_show')).toBeGreaterThan(0.02);
    expect(share('no_show')).toBeLessThan(0.11);
    expect(past.every((a) => ['completed', 'cancelled', 'no_show'].includes(a.status))).toBe(true);

    for (const a of past.filter((x) => x.status === 'completed')) {
      const q = a.queue!;
      expect(q.tokenNumber).toBeGreaterThan(0);
      expect(q.checkedInAt! < q.startedAt!).toBe(true);
      expect(q.startedAt! < q.completedAt!).toBe(true);
      expect(a.statusHistory.map((h) => h.status)).toEqual([
        'scheduled',
        'checked_in',
        'in_consultation',
        'completed',
      ]);
    }
    for (const a of past.filter((x) => x.status === 'cancelled')) {
      expect(a.cancellation).toMatchObject({ reason: expect.any(String), at: expect.any(Date) });
      expect(a.isSlotActive).toBe(false);
    }

    const followUps = past.filter((a) => a.type === 'follow_up');
    expect(followUps.length).toBeGreaterThan(5);
    for (const f of followUps) {
      const first = all.find((a) => a._id.equals(f.followUpOf!))!;
      expect(first.status).toBe('completed');
      expect(first.patient.equals(f.patient)).toBe(true);
      expect(first.doctor.equals(f.doctor)).toBe(true);
      expect(first.startAt < f.startAt).toBe(true);
    }
    expect(past.every((a) => a.reason)).toBe(true);
  });

  it('upcoming: scheduled only, incl. two for patient1', async () => {
    const future = all.filter((a) => a.startAt >= tomorrowStart);
    expect(future.length).toBeGreaterThanOrEqual(35);
    expect(future.every((a) => a.status === 'scheduled')).toBe(true);
    const patient1 = await User.findOne({ email: patientLogins()[0]!.email }).lean();
    const mine = future.filter((a) => a.patient.equals(patient1!.patient!));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mine.map((a) => a.doctor.toString())).size).toBeGreaterThanOrEqual(2);
  });

  it('today: a live queue (when doctors work today) with tokens continuing from the counter', async () => {
    const todays = all.filter((a) => a.startAt >= todayStart && a.startAt < tomorrowStart);
    if (weekdayOf(today) === 0) {
      expect(todays).toEqual([]); // Sunday: clinic closed
      return;
    }
    const by = (s: string) => todays.filter((a) => a.status === s);
    expect(by('completed').length).toBeGreaterThanOrEqual(3);
    expect(by('in_consultation').length).toBeGreaterThanOrEqual(1);
    expect(by('checked_in').length).toBeGreaterThanOrEqual(5);
    expect(by('checked_in').some((a) => a.priority === 'emergency')).toBe(true);
    expect(todays.some((a) => a.type === 'walk_in' && a.status === 'checked_in')).toBe(true);
    // At most one patient with each doctor.
    const withDoctor = by('in_consultation').map((a) => a.doctor.toString());
    expect(new Set(withDoctor).size).toBe(withDoctor.length);
    for (const doctor of new Set(todays.map((a) => a.doctor.toString()))) {
      const tokens = todays
        .filter((a) => a.doctor.toString() === doctor && a.queue?.tokenNumber)
        .map((a) => a.queue!.tokenNumber!);
      if (tokens.length === 0) continue;
      expect(new Set(tokens).size).toBe(tokens.length);
      const counter = await Counter.findById(tokenCounterKey(doctor, today)).lean();
      expect(counter!.seq).toBe(Math.max(...tokens));
    }
    // Later today: still scheduled, in the future.
    for (const a of by('scheduled')) expect(a.startAt > new Date()).toBe(true);
  });

  it('numbers are APT-<year>-NNNNNN and unique', () => {
    expect(all.every((a) => /^APT-\d{4}-\d{6}$/.test(a.appointmentNumber))).toBe(true);
    expect(new Set(all.map((a) => a.appointmentNumber)).size).toBe(all.length);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const again = await runSeed();
    expect(again.appointments).toMatchObject({ created: 0, unchanged: all.length, skipped: 0 });
    expect(await Appointment.countDocuments()).toBe(all.length);
  }, 120_000);
});
