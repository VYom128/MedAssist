import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { addDaysToDate } from '../src/utils/dates.js';
import { createUser, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { Notification } from '../src/modules/notifications/model.js';
import { captureEmails } from './helpers/email.js';
import {
  at,
  createDoctor,
  createPatient,
  createSchedule,
  insertAppointment,
  nextWeekday,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** Doctor leave and schedule changes vs booked appointments (spec §4.13, §7.6). */

let admin: LoggedIn;
let doctorId: string;
let day: string; // a Monday ahead

async function booked(time: string, status = 'scheduled', date = day) {
  const patient = await createPatient({ firstName: 'Meera', lastName: 'Nair' });
  return insertAppointment({
    patient: patient.id,
    doctor: doctorId,
    startAt: at(date, time),
    status,
  });
}
const addLeave = (body: object) =>
  api().post(`/api/v1/doctors/${doctorId}/leaves`).set(admin.auth).send(body);

describe('leave and schedule impact', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    admin = await loginAs('admin');
    doctorId = (await createDoctor({ firstName: 'Anil', lastName: 'Rao' })).id;
    await createSchedule(doctorId);
    day = nextWeekday(1, 3);
  });
  afterEach(() => emails.restore());

  describe('POST /doctors/:id/leaves', () => {
    it('returns the scheduled and checked-in appointments in the period', async () => {
      const a = await booked('09:00');
      const b = await booked('11:00', 'checked_in');
      await booked('10:00', 'cancelled');
      await booked('10:15', 'no_show');
      await booked('09:00', 'scheduled', addDaysToDate(day, 1)); // outside the leave

      const res = await addLeave({ date: day, fullDay: true });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.affectedAppointments).toEqual([
        {
          id: a._id.toString(),
          appointmentNumber: a.appointmentNumber,
          status: 'scheduled',
          startAt: at(day, '09:00').toISOString(),
          endAt: at(day, '09:15').toISOString(),
          patientShortName: 'Meera N.',
        },
        expect.objectContaining({ id: b._id.toString(), status: 'checked_in' }),
      ]);
    });

    it('a partial-day leave lists only overlapping appointments', async () => {
      await booked('09:00');
      const inside = await booked('10:30');
      await booked('12:00');
      const res = await addLeave({
        startAt: at(day, '10:00').toISOString(),
        endAt: at(day, '11:00').toISOString(),
      });
      expect(res.body.data.affectedAppointments.map((x: { id: string }) => x.id)).toEqual([
        inside._id.toString(),
      ]);
    });

    it('tells the receptionists in-app (doctor, period, count – no patient details, no email)', async () => {
      const desk1 = await createUser('receptionist', { email: 'desk1@clinic.dev' });
      const desk2 = await createUser('receptionist', { email: 'desk2@clinic.dev' });
      await createUser('receptionist', { email: 'gone@clinic.dev', isActive: false });
      await booked('09:00');
      await booked('09:30');
      await addLeave({ date: day, fullDay: true });
      const type = 'doctor.leave_affects_appointments';
      await vi.waitFor(async () => expect(await Notification.countDocuments({ type })).toBe(2));
      const notes = await Notification.find({ type }).lean();
      expect(notes.map((n) => n.recipient.toString()).sort()).toEqual(
        [desk1._id.toString(), desk2._id.toString()].sort(),
      );
      const [note] = notes;
      expect(note!.title).toBe('Doctor leave affects booked appointments');
      expect(note!.body).toMatch(/Anil Rao will be on leave/);
      expect(note!.body).toMatch(/2 booked appointments need to be rescheduled/);
      expect(JSON.stringify(notes)).not.toMatch(/Meera|Nair|APT-/);
      expect(note!.data).toEqual({ count: 2 });
      expect(emails.sent).toHaveLength(0); // in-app only (spec §11)
    });

    it('no affected appointments → no email', async () => {
      await createUser('receptionist', { email: 'desk@clinic.dev' });
      const res = await addLeave({ date: day, fullDay: true });
      expect(res.body.data.affectedAppointments).toEqual([]);
      await new Promise((r) => setTimeout(r, 100));
      expect(emails.sent).toEqual([]);
    });

    it('cannot be put over appointments in consultation or completed → 409', async () => {
      for (const status of ['in_consultation', 'completed']) {
        await DoctorLeave.deleteMany({});
        await Appointment.deleteMany({});
        const held = await booked('09:00', status);
        const res = await addLeave({ date: day, fullDay: true });
        expect(res.status, status).toBe(409);
        expect(expectErrorShape(res.body, 'CONFLICT').error.details).toEqual({
          appointments: [held.appointmentNumber],
        });
        expect(await DoctorLeave.countDocuments()).toBe(0);
      }
    });

    it('takes the booking lock (bookingVersion)', async () => {
      await addLeave({ date: day, fullDay: true });
      const profile = await DoctorProfile.findOne({ user: doctorId }).lean();
      expect(profile).toMatchObject({ lockVersion: 1, bookingVersion: 1 });
    });
  });

  describe('PUT /doctors/:id/schedule', () => {
    const replace = (days: object[], effectiveFrom = addDaysToDate(day, -2)) =>
      api()
        .put(`/api/v1/doctors/${doctorId}/schedule`)
        .set(admin.auth)
        .send({ effectiveFrom, days });

    it('lists upcoming appointments outside the new sessions', async () => {
      const early = await booked('09:00'); // new hours start at 10:00
      await booked('10:00'); // fits
      const late = await booked('12:45', 'checked_in'); // new hours end at 12:30
      const tuesday = await booked('10:00', 'scheduled', addDaysToDate(day, 1)); // Tuesday: day off
      await booked('09:00', 'cancelled'); // not counted

      const res = await replace([
        { weekday: 1, sessions: [{ start: '10:00', end: '12:30' }] },
        { weekday: 3, sessions: [{ start: '09:00', end: '13:00' }] },
      ]);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.affectedAppointments.map((a: { id: string }) => a.id)).toEqual([
        early._id.toString(),
        late._id.toString(),
        tuesday._id.toString(),
      ]);
    });

    it('appointments before effectiveFrom are not affected', async () => {
      await booked('09:00');
      const res = await replace([], addDaysToDate(day, 1));
      expect(res.body.data.affectedAppointments).toEqual([]);
    });

    it('a service running past the new session end is affected', async () => {
      const long = await insertAppointment({
        patient: (await createPatient()).id,
        doctor: doctorId,
        startAt: at(day, '12:00'),
        minutes: 45,
      });
      const res = await replace([{ weekday: 1, sessions: [{ start: '09:00', end: '12:30' }] }]);
      expect(res.body.data.affectedAppointments.map((a: { id: string }) => a.id)).toEqual([
        long._id.toString(),
      ]);
    });
  });
});
