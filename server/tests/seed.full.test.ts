import { Appointment } from '../src/modules/appointments/model.js';
import { Department } from '../src/modules/departments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { FollowupRequest } from '../src/modules/followups/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { LabTest } from '../src/modules/labTests/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { Service } from '../src/modules/services/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { User } from '../src/modules/users/model.js';
import { collectionCountsTable, demoLogins, runSeed } from '../src/seed/index.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../src/seed/users.js';
import { clinicToday, endOfClinicDay, startOfClinicDay } from '../src/utils/dates.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api } from './helpers/testApp.js';

/**
 * The full demo seed on the in-memory replica set (spec §15.3), run once: the counts, the
 * time-relative data around today, an intact audit hash chain (the seed writes through the
 * services) and every demo login.
 */

const TZ = 'Asia/Kolkata';
const DAY = 86_400_000;

describe('full demo seed', () => {
  let emails: ReturnType<typeof captureEmails>;

  beforeAll(async () => {
    await Promise.all([
      DoctorProfile.init(),
      DoctorSchedule.init(),
      Appointment.init(),
      Encounter.init(),
      Prescription.init(),
      LabOrder.init(),
      Invoice.init(),
    ]);
    await resetDb();
    emails = captureEmails();
    await runSeed();
  }, 180_000);
  afterAll(() => emails.restore());

  it('creates the §15.3 amounts', async () => {
    const roles = await User.aggregate<{ _id: string; n: number }>([
      { $group: { _id: '$role', n: { $sum: 1 } } },
    ]);
    expect(Object.fromEntries(roles.map((r) => [r._id, r.n]))).toEqual({
      admin: 1,
      receptionist: 2,
      labtech: 2,
      doctor: 8,
      patient: 9, // 8 portal logins + 1 pending self-sign-up
    });
    expect(await Department.countDocuments()).toBe(5);
    expect(await Service.countDocuments()).toBe(12);
    expect(await LabTest.countDocuments()).toBe(15);
    // Weekly templates (7 weekday documents per doctor): 6 doctors work mornings and evenings,
    // one only mornings, one only evenings.
    const sessions = await DoctorSchedule.find().select('doctor sessions').lean();
    const shifts = new Map<string, Set<string>>();
    for (const day of sessions) {
      const set = shifts.get(String(day.doctor)) ?? new Set<string>();
      for (const s of day.sessions) set.add(s.start < '12:00' ? 'morning' : 'evening');
      shifts.set(String(day.doctor), set);
    }
    const kinds = [...shifts.values()].map((x) => [...x].sort().join('+')).sort();
    expect(kinds).toEqual([...Array(6).fill('evening+morning'), 'evening', 'morning'].sort());
    expect(await DoctorLeave.countDocuments({ startAt: { $gt: new Date() } })).toBe(2);
    expect(await Patient.countDocuments()).toBe(60);
    expect(await Patient.countDocuments({ 'allergies.0': { $exists: true } })).toBeGreaterThan(0);
    expect(
      await Patient.countDocuments({ 'chronicConditions.0': { $exists: true } }),
    ).toBeGreaterThan(0);
    expect(await FollowupRequest.countDocuments()).toBe(15);
    expect(await ClinicalSummary.countDocuments({ status: 'approved' })).toBe(3);
    expect((await PatientExplanation.distinct('language', { cached: true })).sort()).toEqual([
      'en',
      'hi',
    ]);
    expect(await collectionCountsTable()).toMatch(/patients\s+60/);
  });

  it('~300 appointments: past 60 days ≈ 85/10/5, today’s queue, the next 14 days', async () => {
    const today = clinicToday(TZ);
    const startToday = startOfClinicDay(today, TZ);
    const total = await Appointment.countDocuments();
    expect(total).toBeGreaterThanOrEqual(270);
    expect(total).toBeLessThanOrEqual(330);

    const past = await Appointment.aggregate<{ _id: string; n: number }>([
      { $match: { startAt: { $lt: startToday } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(past.map((x) => [x._id, x.n]));
    const pastTotal = past.reduce((s, x) => s + x.n, 0);
    // Only these three can end a past visit; the spec's 70 / 10 / 5 leaves 15 % that can only be
    // completed (D194).
    expect(Object.keys(byStatus).sort()).toEqual(['cancelled', 'completed', 'no_show']);
    expect(byStatus.cancelled! / pastTotal).toBeGreaterThan(0.07);
    expect(byStatus.cancelled! / pastTotal).toBeLessThan(0.14);
    expect(byStatus.no_show! / pastTotal).toBeGreaterThan(0.03);
    expect(byStatus.no_show! / pastTotal).toBeLessThan(0.08);
    expect(
      await Appointment.countDocuments({ startAt: { $lt: new Date(Date.now() - 61 * DAY) } }),
    ).toBe(0);

    const todays = await Appointment.distinct('status', {
      startAt: { $gte: startToday, $lt: endOfClinicDay(today, TZ) },
    });
    expect(todays).toEqual(expect.arrayContaining(['checked_in', 'in_consultation']));
    const upcoming = await Appointment.countDocuments({
      startAt: { $gte: endOfClinicDay(today, TZ), $lt: new Date(Date.now() + 15 * DAY) },
      status: 'scheduled',
    });
    expect(upcoming).toBeGreaterThan(0);
    expect(
      await Appointment.countDocuments({ startAt: { $gte: new Date(Date.now() + 15 * DAY) } }),
    ).toBe(0);
  });

  it('a signed note per completed visit, prescriptions for most, invoices in every state', async () => {
    const completed = await Appointment.find({ status: 'completed' }).select('_id').lean();
    const notes = await Encounter.countDocuments({
      appointment: { $in: completed.map((a) => a._id) },
      status: { $in: ['signed', 'amended'] },
    });
    expect(notes).toBe(completed.length);
    expect(await Prescription.countDocuments({ status: { $ne: 'draft' } })).toBeGreaterThan(
      notes * 0.7,
    );
    const invoiceStates = await Invoice.distinct('status');
    expect(invoiceStates).toEqual(
      expect.arrayContaining(['paid', 'partially_paid', 'issued', 'void']),
    );
    expect(await Invoice.countDocuments({ status: 'void' })).toBeGreaterThanOrEqual(1);
  });

  it('~80 lab orders in every workflow status, with critical values', async () => {
    const total = await LabOrder.countDocuments();
    expect(total).toBeGreaterThanOrEqual(75);
    expect(total).toBeLessThanOrEqual(85);
    expect((await LabOrder.distinct('status')).sort()).toEqual(
      expect.arrayContaining([
        'ordered',
        'sample_collected',
        'sample_rejected',
        'processing',
        'result_entered',
        'verified',
        'released',
      ]),
    );
    expect(
      await LabOrder.countDocuments({
        'items.results.flag': { $in: ['critical_low', 'critical_high'] },
      }),
    ).toBeGreaterThan(0);
  });

  it('the audit hash chain written by the seed verifies through the API', async () => {
    const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: DEMO_PASSWORD });
    const res = await api()
      .get('/api/v1/audit-logs/verify')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true });
    expect(res.body.data.checked).toBeGreaterThan(500);
  });

  it('every demo login works with the demo password, without a forced change', async () => {
    const logins = demoLogins();
    expect(logins).toHaveLength(DEMO_ACCOUNTS.length + 8 + 9);
    for (const { email } of logins) {
      const res = await api().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
      expect(res.status, email).toBe(200);
      expect(res.body.data.user.mustChangePassword, email).toBe(false);
    }
  });
});
