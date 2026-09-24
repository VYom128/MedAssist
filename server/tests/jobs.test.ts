import type { Server } from 'socket.io';
import { startJobs } from '../src/jobs/index.js';
import { runNoShowJob } from '../src/jobs/noShow.job.js';
import { runReminderJob } from '../src/jobs/reminders.job.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { auditEntries, resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { createDoctor, createPatient, insertAppointment, setSettings } from './helpers/fixtures.js';

/** Background jobs (spec §8.11), called directly with a fixed "now". */

const NOW = new Date('2026-10-05T06:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const fromNow = (ms: number) => new Date(NOW.getTime() + ms);

let doctorId: string;
let slot = 0;
/** An appointment whose patient has an email; each gets its own start minute. */
async function appt(startAt: Date, extra: Record<string, unknown> = {}) {
  slot += 1;
  const patient = await createPatient({ email: `p${slot}@example.com` });
  return insertAppointment({
    patient: patient.id,
    doctor: doctorId,
    startAt: new Date(startAt.getTime() + (slot % 7) * 1000), // distinct starts
    ...extra,
  });
}

describe('background jobs', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    doctorId = (await createDoctor()).id;
  });
  afterEach(() => emails.restore());

  describe('runReminderJob', () => {
    it('reminds appointments starting reminderHoursBefore from now (± 15 min), once', async () => {
      const due = await appt(fromNow(24 * HOUR));
      const edge = await appt(fromNow(24 * HOUR + 14 * MIN));
      await appt(fromNow(24 * HOUR + 40 * MIN)); // next run
      await appt(fromNow(2 * HOUR)); // too soon: already had its confirmation
      await appt(fromNow(24 * HOUR), { reminderSentAt: fromNow(-HOUR) }); // already reminded
      await appt(fromNow(24 * HOUR + MIN), { status: 'cancelled' });

      expect(await runReminderJob(NOW)).toEqual({ sent: 2, failed: 0 });
      const reminded = await Appointment.find({ reminderSentAt: NOW }).lean();
      expect(reminded.map((a) => a._id.toString()).sort()).toEqual(
        [due._id.toString(), edge._id.toString()].sort(),
      );
      await vi.waitFor(() => expect(emails.sent).toHaveLength(2));
      expect(emails.sent[0]!.subject).toBe('Appointment reminder');
      expect(emails.sent[0]!.text).toMatch(/^Reminder: your appointment APT-/);

      // Later runs pick up the 24 h 40 min one once, and never resend the first two.
      expect(await runReminderJob(fromNow(15 * MIN))).toEqual({ sent: 0, failed: 0 });
      expect(await runReminderJob(fromNow(30 * MIN))).toEqual({ sent: 1, failed: 0 });
      expect(await runReminderJob(fromNow(45 * MIN))).toEqual({ sent: 0, failed: 0 });
    });

    it('overlapping runs never send the same reminder twice', async () => {
      for (let i = 0; i < 5; i += 1) await appt(fromNow(24 * HOUR + i * MIN));
      const results = await Promise.all([runReminderJob(NOW), runReminderJob(NOW)]);
      expect(results[0]!.sent + results[1]!.sent).toBe(5);
      await vi.waitFor(() => expect(emails.sent).toHaveLength(5));
      expect(new Set(emails.sent.map((m) => m.to)).size).toBe(5);
    });

    it('follows settings.appointment.reminderHoursBefore', async () => {
      await setSettings({ 'appointment.reminderHoursBefore': 2 });
      await appt(fromNow(2 * HOUR));
      await appt(fromNow(24 * HOUR));
      expect((await runReminderJob(NOW)).sent).toBe(1);
    });

    it('a patient who opted out of emails is still marked reminded, but not emailed', async () => {
      const a = await appt(fromNow(24 * HOUR));
      const { Patient } = await import('../src/modules/patients/model.js');
      await Patient.updateOne(
        { _id: a.patient },
        { $set: { 'consent.communications.email': false } },
      );
      expect((await runReminderJob(NOW)).sent).toBe(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(emails.sent).toEqual([]);
    });
  });

  describe('runNoShowJob', () => {
    it('marks scheduled appointments past endAt + grace as no-show, by the system', async () => {
      const missed = await appt(fromNow(-HOUR)); // ends 45 min ago (> 30 min grace)
      const recent = await appt(fromNow(-35 * MIN)); // ends 20 min ago: still in grace
      const arrived = await appt(fromNow(-2 * HOUR), { status: 'checked_in' });
      const undone = await appt(fromNow(-3 * HOUR), { noShowUndoneAt: fromNow(-HOUR) });
      await appt(fromNow(-4 * HOUR), { status: 'cancelled' });

      const emitted: string[] = [];
      setSocketServer({
        to: () => ({ emit: (event: string) => emitted.push(event) }),
      } as never as Server);
      try {
        expect(await runNoShowJob(NOW)).toEqual({ marked: 1, skipped: 0, failed: 0 });
      } finally {
        setSocketServer(null);
      }

      const stored = await Appointment.findById(missed._id).lean();
      expect(stored).toMatchObject({ status: 'no_show', isSlotActive: false });
      expect(stored!.statusHistory.at(-1)).toMatchObject({
        status: 'no_show',
        by: null,
        note: 'Not checked in (automatic)',
      });
      for (const other of [recent, arrived, undone]) {
        const s = await Appointment.findById(other._id).lean();
        expect(s!.status, other._id.toString()).toBe(other.status);
      }
      const [entry] = await auditEntries('appointment.no_show');
      expect(entry).toMatchObject({
        actor: { user: null, role: 'system' },
        metadata: { via: 'job' },
        patient: missed.patient,
      });
      expect(emitted).toContain('queue.updated');
      await vi.waitFor(() =>
        expect(emails.sent.map((m) => m.subject)).toEqual(['Missed appointment']),
      );

      // Idempotent.
      expect(await runNoShowJob(NOW)).toEqual({ marked: 0, skipped: 0, failed: 0 });
    });

    it('follows settings.appointment.noShowGraceMinutes', async () => {
      await setSettings({ 'appointment.noShowGraceMinutes': 90 });
      await appt(fromNow(-HOUR)); // ended 45 min ago: within 90 min
      expect((await runNoShowJob(NOW)).marked).toBe(0);
    });

    it('one failure does not stop the others (and the job does not throw)', async () => {
      await appt(fromNow(-3 * HOUR));
      await appt(fromNow(-2 * HOUR));
      const spy = vi.spyOn(Appointment, 'findOneAndUpdate').mockImplementationOnce(() => {
        throw new Error('database hiccup');
      });
      try {
        expect(await runNoShowJob(NOW)).toEqual({ marked: 1, skipped: 0, failed: 1 });
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('startJobs does nothing when JOBS_ENABLED is off (tests)', async () => {
    const stop = await startJobs();
    await expect(stop()).resolves.toBeUndefined();
  });
});
