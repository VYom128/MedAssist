import { Types } from 'mongoose';
import { runFollowUpReminderJob } from '../src/jobs/followUpReminders.job.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { FollowupReminder } from '../src/modules/followupReminders/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import {
  addDaysToDate,
  calendarDate,
  calendarDateString,
  clinicToday,
} from '../src/utils/dates.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createPatient,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  readyToSign,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Follow-up reminders (spec §8.11, §4.10, Phase 8): the reminder is written when the note is
 * signed and follows amendments; the daily job emails the patient two days before the due date,
 * skips booked follow-ups and never sends twice.
 */

let emails: ReturnType<typeof captureEmails>;
let tz: string;
beforeEach(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    FollowupReminder.init(),
  ]);
  tz = await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const today = () => clinicToday(tz);

describe('reminders follow the signed note', () => {
  it('signing a note with a follow-up plan creates a pending reminder; without one, none', async () => {
    const planned = await readyToSign({
      items: [],
      note: { followUp: { required: true, afterDays: 7, instructions: 'Bring the reports' } },
    });
    await signNote(planned.doctor, planned.encounterId);
    const reminder = await FollowupReminder.findOne({ encounter: planned.encounterId }).lean();
    expect(reminder).toMatchObject({ status: 'pending' });
    expect(calendarDateString(reminder!.dueDate)).toBe(addDaysToDate(today(), 7));
    expect(reminder!.doctor.toString()).toBe(planned.doctor.id);
    expect(reminder!.appointment.toString()).toBe(planned.appointmentId);

    const none = await readyToSign({ items: [] });
    await signNote(none.doctor, none.encounterId);
    expect(await FollowupReminder.countDocuments({ encounter: none.encounterId })).toBe(0);
  });

  it('an amendment moves a pending reminder, or cancels it when the plan is removed', async () => {
    const c = await readyToSign({
      items: [],
      note: { followUp: { required: true, afterDays: 7 } },
    });
    await signNote(c.doctor, c.encounterId);
    const amend = (followUp: object) =>
      api()
        .post(`/api/v1/encounters/${c.encounterId}/amendments`)
        .set(c.doctor.auth)
        .send({ reason: 'Follow-up plan changed', changes: { followUp } });

    const later = addDaysToDate(today(), 20);
    expect((await amend({ required: true, date: later })).status).toBe(201);
    let reminder = await FollowupReminder.findOne({ encounter: c.encounterId }).lean();
    expect(calendarDateString(reminder!.dueDate)).toBe(later);
    expect(reminder!.status).toBe('pending');

    expect((await amend({ required: false })).status).toBe(201);
    reminder = await FollowupReminder.findOne({ encounter: c.encounterId }).lean();
    expect(reminder).toMatchObject({ status: 'skipped', skipReason: 'cancelled' });
  });
});

describe('runFollowUpReminderJob', () => {
  /** A reminder for a completed visit of a patient with a portal login. */
  async function reminderDueIn(
    days: number,
    { patientId, doctorId }: { patientId?: string; doctorId?: string } = {},
  ) {
    const patient = patientId ? null : await loginAsPatient();
    const pid = patientId ?? patient!.patientId;
    const doctor = doctorId ?? (await loginAsDoctor()).id;
    const visitAt = new Date(Date.now() - 5 * 86_400_000);
    const visit = await insertAppointment({
      patient: pid,
      doctor,
      startAt: visitAt,
      status: 'completed',
      isSlotActive: false,
    });
    const reminder = await FollowupReminder.create({
      encounter: new Types.ObjectId(),
      appointment: visit._id,
      patient: pid,
      doctor,
      visitAt,
      dueDate: calendarDate(addDaysToDate(today(), days)),
    });
    return { reminder, patient, patientId: pid, doctorId: doctor, visit };
  }

  it('emails only the reminders due in two days, with a booking link and no clinical details', async () => {
    const due = await reminderDueIn(2);
    await reminderDueIn(1);
    await reminderDueIn(3);
    const result = await runFollowUpReminderJob(new Date());
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(emails.sent).toHaveLength(1);
    const [mail] = emails.sent;
    expect(mail!.to).toBe(due.patient!.user.email);
    const text = JSON.stringify(mail);
    expect(text).toContain(
      `/patient/appointments/book?doctor=${due.doctorId}&followUpOf=${due.visit._id.toString()}`,
    );
    expect(text).not.toMatch(/diagnos|instructions|reports/i);
    expect(await FollowupReminder.findById(due.reminder._id).lean()).toMatchObject({
      status: 'sent',
      sentAt: expect.any(Date),
    });
  });

  it('never sends twice, even when two runs overlap', async () => {
    await reminderDueIn(2);
    const [a, b] = await Promise.all([
      runFollowUpReminderJob(new Date()),
      runFollowUpReminderJob(new Date()),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect((await runFollowUpReminderJob(new Date())).sent).toBe(0);
    expect(emails.sent).toHaveLength(1);
  });

  it('skips follow-ups already booked with the doctor or linked to the visit', async () => {
    const sameDoctor = await reminderDueIn(2);
    await insertAppointment({
      patient: sameDoctor.patientId,
      doctor: sameDoctor.doctorId,
      startAt: new Date(Date.now() + 86_400_000),
    });
    const linked = await reminderDueIn(2);
    await insertAppointment({
      patient: linked.patientId,
      doctor: (await loginAsDoctor()).id,
      startAt: new Date(Date.now() + 86_400_000),
      type: 'follow_up',
      followUpOf: linked.visit._id,
    });
    // A cancelled booking does not count.
    const cancelled = await reminderDueIn(2);
    await insertAppointment({
      patient: cancelled.patientId,
      doctor: cancelled.doctorId,
      startAt: new Date(Date.now() + 86_400_000),
      status: 'cancelled',
      isSlotActive: false,
    });

    const result = await runFollowUpReminderJob(new Date());
    expect(result).toEqual({ sent: 1, skipped: 2, failed: 0 });
    expect(await FollowupReminder.findById(sameDoctor.reminder._id).lean()).toMatchObject({
      status: 'skipped',
      skipReason: 'booked',
    });
    expect(emails.sent.map((m) => m.to)).toEqual([cancelled.patient!.user.email]);
  });

  it('skips patients without a portal login', async () => {
    const { id } = await createPatient({ email: 'no-portal@example.com' });
    const r = await reminderDueIn(2, { patientId: id });
    expect(await runFollowUpReminderJob(new Date())).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(await FollowupReminder.findById(r.reminder._id).lean()).toMatchObject({
      status: 'skipped',
      skipReason: 'no_contact',
    });
    expect(emails.sent).toHaveLength(0);
  });
});
