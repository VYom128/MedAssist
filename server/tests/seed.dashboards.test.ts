import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { FollowupReminder } from '../src/modules/followupReminders/model.js';
import { FollowupRequest } from '../src/modules/followups/model.js';
import { Notification } from '../src/modules/notifications/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { User } from '../src/modules/users/model.js';
import { DEMO_PASSWORD } from '../src/seed/users.js';
import { runSeed } from '../src/seed/index.js';
import { logger } from '../src/utils/logger.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api } from './helpers/testApp.js';

/**
 * Phase 10 on seed-size data: every dashboard answers with something to show, quickly (spec §17:
 * < 500 ms – logged here; the test allows slack for the in-memory server), and every demo login
 * except the admin starts with unread notifications. Re-running the seed adds none.
 */

const DASHBOARDS: [string, string][] = [
  ['admin@medassist.dev', 'admin'],
  ['reception1@medassist.dev', 'reception'],
  ['dr.mehta@medassist.dev', 'doctor'],
  ['lab2@medassist.dev', 'lab'],
  ['patient1@medassist.dev', 'patient'],
];

describe('dashboards on the seed', () => {
  let emails: ReturnType<typeof captureEmails>;

  beforeAll(async () => {
    await Promise.all([
      DoctorProfile.init(),
      DoctorSchedule.init(),
      Appointment.init(),
      Encounter.init(),
      Prescription.init(),
      NoteAmendment.init(),
      FollowupRequest.init(),
      FollowupReminder.init(),
      ClinicalSummary.init(),
      PatientExplanation.init(),
      Notification.init(),
    ]);
    await resetDb();
    emails = captureEmails();
    await runSeed();
  }, 300_000);
  afterAll(() => emails.restore());

  const login = async (email: string) => {
    const res = await api().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
  };

  it('every dashboard answers fast with something to show', async () => {
    const timings: Record<string, number> = {};
    const data: Record<string, Record<string, any>> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const [email, role] of DASHBOARDS) {
      const auth = await login(email);
      await api().get(`/api/v1/dashboard/${role}`).set(auth); // warm up (connections, caches)
      const started = performance.now();
      const res = await api().get(`/api/v1/dashboard/${role}`).set(auth);
      timings[role] = Math.round(performance.now() - started);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      data[role] = res.body.data;
    }
    logger.info({ timings }, 'Dashboard response times on the seed (ms)');
    process.stdout.write(`Dashboard response times on the seed (ms): ${JSON.stringify(timings)}\n`);
    for (const [role, ms] of Object.entries(timings)) expect(ms, role).toBeLessThan(2000);

    expect(data.admin!.appointmentsToday.total).toBeGreaterThan(0);
    expect(data.admin!.revenue.thisMonthPaise + data.admin!.revenue.lastMonthPaise).toBeGreaterThan(
      0,
    );
    expect(data.admin!.doctorUtilisation.length).toBe(8);
    expect(data.admin!.labTurnaround.count).toBeGreaterThan(0);
    expect(data.admin!.labTurnaround.medianHours).toBeLessThan(48); // seeded lab times are back-dated
    expect(data.reception!.checkInsWaiting).toBeGreaterThan(0);
    expect(data.reception!.openFollowups).toBeGreaterThan(0);
    expect(data.doctor!.queueToday.total).toBeGreaterThan(0);
    expect(data.doctor!.resultsToReview.count).toBeGreaterThan(0);
    expect(data.lab!.openTotal).toBeGreaterThan(0);
    expect(data.lab!.pendingVerificationByOthers).toBeGreaterThan(0);
    expect(data.patient!.nextAppointment).not.toBeNull();
  });

  it('every demo login except the admin has unread notifications', async () => {
    const users = await User.find({
      email: /@medassist\.dev$/,
      patientLinkStatus: { $ne: 'pending_verification' },
    })
      .select('email role')
      .lean();
    for (const u of users) {
      const unread = await Notification.countDocuments({ recipient: u._id, readAt: null });
      if (u.role === 'admin') expect(unread, u.email).toBe(0);
      else expect(unread, u.email).toBeGreaterThan(0);
    }
  });

  it('running the seed again adds no notifications', async () => {
    const before = await Notification.countDocuments();
    const summary = await runSeed();
    expect(summary.notifications).toMatchObject({ created: 0 });
    expect(await Notification.countDocuments()).toBe(before);
  }, 300_000);
});
