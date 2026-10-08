import { runFollowUpReminderJob } from '../src/jobs/followUpReminders.job.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { FollowupReminder } from '../src/modules/followupReminders/model.js';
import { FollowupRequest } from '../src/modules/followups/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { User } from '../src/modules/users/model.js';
import { runSeed } from '../src/seed/index.js';
import { FOLLOWUP_REQUEST_STATUSES, FOLLOWUP_REQUEST_TYPES } from '../src/config/constants.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';

/** Follow-up requests, reminders and shared diagnoses in the seed (Phase 8, spec §15.3). */

describe('follow-up seed', () => {
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
    ]);
    await resetDb();
    emails = captureEmails();
    await runSeed();
  }, 180_000);
  afterAll(() => emails.restore());

  it('has requests in every status and type, with threads, a staff note and an attachment', async () => {
    const requests = await FollowupRequest.find().lean();
    expect(requests).toHaveLength(15);
    expect([...new Set(requests.map((r) => r.status))].sort()).toEqual(
      [...FOLLOWUP_REQUEST_STATUSES].sort(),
    );
    expect([...new Set(requests.map((r) => r.type))].sort()).toEqual(
      [...FOLLOWUP_REQUEST_TYPES].sort(),
    );
    const messages = requests.flatMap((r) => r.messages);
    expect(messages.some((m) => m.visibility === 'staff')).toBe(true);
    expect(messages.some((m) => m.role === 'patient')).toBe(true);
    expect(messages.some((m) => m.role === 'doctor')).toBe(true);
    expect(requests.filter((r) => r.attachments.length > 0)).toHaveLength(1);
    expect(
      requests.filter((r) => r.status === 'rejected' && r.closedReason).length,
    ).toBeGreaterThan(0);

    // patient1 has several; the scheduled ones point at real follow-up appointments.
    const patient1 = await User.findOne({ email: 'patient1@medassist.dev' }).lean();
    expect(
      requests.filter((r) => r.patient.equals(patient1!.patient!)).length,
    ).toBeGreaterThanOrEqual(3);
    const scheduled = requests.filter((r) => r.status === 'scheduled');
    expect(scheduled).toHaveLength(2);
    for (const r of scheduled) {
      const appt = await Appointment.findById(r.resultingAppointment).lean();
      expect(appt).toMatchObject({ type: 'follow_up', status: 'scheduled' });
      expect(appt!.patient.equals(r.patient)).toBe(true);
    }
    // Back-dated over the last three weeks, threads in order.
    const ages = requests.map((r) => Date.now() - r.createdAt.getTime());
    expect(Math.max(...ages)).toBeGreaterThan(15 * 86_400_000);
  });

  it('shares the diagnosis on about half the notes', async () => {
    const signed = await Encounter.countDocuments({ status: { $in: ['signed', 'amended'] } });
    const shared = await Encounter.countDocuments({ shareDiagnosisWithPatient: true });
    expect(shared / signed).toBeGreaterThan(0.3);
    expect(shared / signed).toBeLessThan(0.7);
  });

  it('gives every planned follow-up a reminder; some are due for the job in two days', async () => {
    const planned = await Encounter.countDocuments({
      status: { $in: ['signed', 'amended'] },
      'followUp.required': true,
    });
    expect(await FollowupReminder.countDocuments()).toBe(planned);
    const result = await runFollowUpReminderJob(new Date());
    expect(result.sent + result.skipped).toBeGreaterThanOrEqual(3);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);
  });
});
