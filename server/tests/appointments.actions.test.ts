import { Appointment } from '../src/modules/appointments/model.js';
import { generateSlots } from '../src/modules/appointments/slots.js';
import { Patient } from '../src/modules/patients/model.js';
import { addDaysToDate, clinicToday, zonedDateTimeToUtc } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createDoctor,
  createPatient,
  createSchedule,
  createService,
  insertAppointment,
  loginAsDoctor,
  setSettings,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Status actions (spec §5.1, §7.8) and walk-ins (§4.5). The clinic timezone is set so that it
 * is about midday now; the doctor works 09:00–16:00.
 */

let tz: string;
let today: string;
let reception: LoggedIn;
let doctor: LoggedIn & { id: string };
let serviceId: string;
const clinicAt = (time: string, date = today) => zonedDateTimeToUtc(date, time, tz);

const act = (id: string, action: string, auth = reception.auth) =>
  api().post(`/api/v1/appointments/${id}/${action}`).set(auth).send({});
/** An appointment of a new patient with `doctor` (default: the logged-in doctor). */
async function appointment(
  time: string,
  status = 'scheduled',
  extra: Record<string, unknown> = {},
) {
  const patient = await createPatient();
  return insertAppointment({
    patient: patient.id,
    doctor: doctor.id,
    startAt: clinicAt(time, (extra.date as string) ?? today),
    status,
    ...extra,
  });
}

describe('appointment status actions', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    tz = await useMiddayClinicZone();
    today = clinicToday(tz);
    reception = await loginAs('receptionist');
    doctor = await loginAsDoctor();
    await createSchedule(doctor.id, [{ start: '09:00', end: '16:00' }]);
    serviceId = (await createService())._id.toString();
  });
  afterEach(() => emails.restore());

  describe('check-in', () => {
    it('assigns tokens per doctor per day, in order, and audits', async () => {
      const first = await appointment('11:00');
      const second = await appointment('11:15');
      const res = await act(first._id.toString(), 'check-in');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'checked_in',
        tokenNumber: 1,
        queue: { tokenNumber: 1, checkedInAt: expect.any(String) },
      });
      expect((await act(second._id.toString(), 'check-in')).body.data.tokenNumber).toBe(2);

      // Another doctor starts at 1.
      const other = await createDoctor();
      const theirs = await insertAppointment({
        patient: (await createPatient()).id,
        doctor: other.id,
        startAt: clinicAt('11:00'),
      });
      expect((await act(theirs._id.toString(), 'check-in')).body.data.tokenNumber).toBe(1);

      const entries = await auditEntries('appointment.check_in');
      expect(entries).toHaveLength(3);
      expect(entries[0]).toMatchObject({ metadata: { queueNumber: 1 } });
    });

    it('parallel check-ins get distinct tokens 1..n', async () => {
      const appts = await Promise.all(
        ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45'].map((t) =>
          appointment(t),
        ),
      );
      const results = await Promise.all(appts.map((a) => act(a._id.toString(), 'check-in')));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
      const tokens = results.map((r) => r.body.data.tokenNumber as number).sort((a, b) => a - b);
      expect(tokens).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }, 30_000);

    it("only on the appointment's clinic day", async () => {
      const tomorrow = await appointment('11:00', 'scheduled', { date: addDaysToDate(today, 1) });
      const res = await act(tomorrow._id.toString(), 'check-in');
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/on the day/);
    });

    it('only from scheduled', async () => {
      const statuses = ['checked_in', 'cancelled', 'no_show', 'completed'];
      for (const [i, status] of statuses.entries()) {
        const appt = await appointment(`10:${String(i * 15).padStart(2, '0')}`, status);
        const res = await act(appt._id.toString(), 'check-in');
        expect(res.status, status).toBe(409);
        expectErrorShape(res.body, 'INVALID_STATUS_TRANSITION');
      }
    });
  });

  describe('start and complete (doctor, own)', () => {
    it('start → in consultation with calledAt/startedAt; complete → completed', async () => {
      const appt = await appointment('11:00', 'checked_in', { queue: { tokenNumber: 1 } });
      const started = await act(appt._id.toString(), 'start', doctor.auth);
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      expect(started.body.data).toMatchObject({
        status: 'in_consultation',
        queue: { tokenNumber: 1, calledAt: expect.any(String), startedAt: expect.any(String) },
      });
      expect(await auditEntries('appointment.start')).toEqual([
        expect.objectContaining({ metadata: expect.objectContaining({ via: 'start' }) }),
      ]);

      const done = await act(appt._id.toString(), 'complete', doctor.auth);
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({
        status: 'completed',
        queue: { completedAt: expect.any(String) },
      });
      expect(await auditEntries('appointment.complete')).toHaveLength(1);
      const stored = await Appointment.findById(appt._id).lean();
      expect(stored!.isSlotActive).toBe(true); // completed visits keep their slot
      expect(stored!.statusHistory.map((h) => h.status)).toEqual(['in_consultation', 'completed']);
    });

    it("another doctor's appointment → 404", async () => {
      const other = await createDoctor();
      const theirs = await insertAppointment({
        patient: (await createPatient()).id,
        doctor: other.id,
        startAt: clinicAt('11:00'),
        status: 'checked_in',
      });
      expect((await act(theirs._id.toString(), 'start', doctor.auth)).status).toBe(404);
      expect((await act(theirs._id.toString(), 'complete', doctor.auth)).status).toBe(404);
    });

    it('a doctor already in consultation today cannot start another → 409', async () => {
      await appointment('10:45', 'in_consultation', { queue: { tokenNumber: 3 } });
      const next = await appointment('11:00', 'checked_in');
      const res = await act(next._id.toString(), 'start', doctor.auth);
      expect(res.status).toBe(409);
      expect(expectErrorShape(res.body, 'CONFLICT').message).toBe(
        'You already have a patient in consultation (token 3). Complete that consultation first.',
      );
    });

    it("a consultation left open on an earlier day does not block today's", async () => {
      await appointment('15:00', 'in_consultation', { date: addDaysToDate(today, -1) });
      const next = await appointment('11:00', 'checked_in');
      expect((await act(next._id.toString(), 'start', doctor.auth)).status).toBe(200);
    });

    it('invalid transitions → 409', async () => {
      const scheduled = await appointment('11:00');
      expectErrorShape(
        (await act(scheduled._id.toString(), 'start', doctor.auth)).body,
        'INVALID_STATUS_TRANSITION',
      );
      expectErrorShape(
        (await act(scheduled._id.toString(), 'complete', doctor.auth)).body,
        'INVALID_STATUS_TRANSITION',
      );
    });

    it('reception cannot start or complete; doctors cannot check in', async () => {
      const appt = await appointment('11:00', 'checked_in');
      expect((await act(appt._id.toString(), 'start')).status).toBe(403);
      expect((await act(appt._id.toString(), 'check-in', doctor.auth)).status).toBe(403);
    });
  });

  describe('no-show and undo', () => {
    it('marks a started appointment as no-show: frees the slot, audits, emails the patient', async () => {
      const appt = await appointment('10:00');
      await Patient.updateOne({ _id: appt.patient }, { $set: { email: 'late@example.com' } });
      const res = await act(appt._id.toString(), 'no-show');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('no_show');
      expect((await Appointment.findById(appt._id).lean())!.isSlotActive).toBe(false);
      expect(await auditEntries('appointment.no_show')).toHaveLength(1);
      await vi.waitFor(() =>
        expect(emails.sent.find((m) => m.to === 'late@example.com')?.subject).toBe(
          'Missed appointment',
        ),
      );
    });

    it('not before the appointment has started → 422', async () => {
      const later = await appointment('15:00');
      expect((await act(later._id.toString(), 'no-show')).status).toBe(422);
    });

    it('undo on the same day while the slot is free: scheduled again, flagged for the job', async () => {
      const appt = await appointment('10:00', 'no_show');
      const res = await act(appt._id.toString(), 'undo-no-show');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe('scheduled');
      const stored = await Appointment.findById(appt._id).lean();
      expect(stored).toMatchObject({ isSlotActive: true, noShowUndoneAt: expect.any(Date) });
      expect(await auditEntries('appointment.undo_no_show')).toHaveLength(1);
    });

    it('undo when the slot was taken meanwhile → 409 SLOT_UNAVAILABLE', async () => {
      const missed = await appointment('10:00', 'no_show');
      await appointment('10:00'); // someone else took the slot
      const res = await act(missed._id.toString(), 'undo-no-show');
      expect(res.status).toBe(409);
      expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
      expect((await Appointment.findById(missed._id).lean())!.status).toBe('no_show');
    });

    it('undo when the patient booked the same doctor again that day → 409', async () => {
      const missed = await appointment('10:00', 'no_show');
      await insertAppointment({
        patient: missed.patient,
        doctor: doctor.id,
        startAt: clinicAt('14:00'),
      });
      expectErrorShape(
        (await act(missed._id.toString(), 'undo-no-show')).body,
        'PATIENT_DOUBLE_BOOKED',
      );
    });

    it('undo only on the same clinic day → 422; only from no-show → 409', async () => {
      const yesterday = await appointment('10:00', 'no_show', { date: addDaysToDate(today, -1) });
      expect((await act(yesterday._id.toString(), 'undo-no-show')).status).toBe(422);
      const scheduled = await appointment('11:00');
      expectErrorShape(
        (await act(scheduled._id.toString(), 'undo-no-show')).body,
        'INVALID_STATUS_TRANSITION',
      );
    });
  });

  describe('POST /appointments/walk-in', () => {
    const walkIn = async (extra: Record<string, unknown> = {}, doctorId = doctor.id) =>
      api()
        .post('/api/v1/appointments/walk-in')
        .set(reception.auth)
        .send({ patientId: (await createPatient()).id, doctorId, serviceId, ...extra });

    it('takes the next free slot of the running session, checked in with a token', async () => {
      const res = await walkIn({ reason: 'Cough', priority: 'priority' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({
        status: 'checked_in',
        type: 'walk_in',
        source: 'walk_in',
        priority: 'priority',
        isOverbook: false,
        tokenNumber: 1,
      });
      const start = new Date(res.body.data.startAt);
      expect(start.getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
      expect(start.getTime() % (15 * 60_000)).toBe(0); // a slot of the 15-minute grid
      expect((await Appointment.findById(res.body.data.id).lean())!.isSlotActive).toBe(true);
      expect(await auditEntries('appointment.create')).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({ source: 'walk_in', isOverbook: false }),
        }),
      ]);
    });

    it('tokens continue after check-ins', async () => {
      const appt = await appointment('11:00');
      await act(appt._id.toString(), 'check-in');
      expect((await walkIn()).body.data.tokenNumber).toBe(2);
    });

    it('a full session → overbook now (up to the limit), then 422 OVERBOOK_LIMIT_REACHED', async () => {
      await setSettings({ 'appointment.walkInOverbookPerSession': 2 });
      // Fill every remaining slot of today's session.
      const free = generateSlots({
        date: today,
        schedule: { sessions: [{ start: '09:00', end: '16:00' }] },
        slotMinutes: 15,
        now: new Date(),
        timezone: tz,
        minLeadMinutes: 0,
      });
      for (const slot of free) {
        await insertAppointment({
          patient: (await createPatient()).id,
          doctor: doctor.id,
          startAt: slot.startAt,
        });
      }
      const first = await walkIn();
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body.data).toMatchObject({ isOverbook: true, status: 'checked_in' });
      expect(Math.abs(new Date(first.body.data.startAt).getTime() - Date.now())).toBeLessThan(
        60_000,
      );
      expect((await Appointment.findById(first.body.data.id).lean())!.isSlotActive).toBe(false);
      expect((await walkIn()).status).toBe(201);
      const third = await walkIn();
      expect(third.status).toBe(422);
      expectErrorShape(third.body, 'OVERBOOK_LIMIT_REACHED');
    });

    it('no session running now → 409 DOCTOR_UNAVAILABLE', async () => {
      const other = await createDoctor();
      await createSchedule(other.id, [{ start: '07:00', end: '08:00' }]);
      const res = await walkIn({}, other.id);
      expect(res.status).toBe(409);
      expectErrorShape(res.body, 'DOCTOR_UNAVAILABLE');
    });

    it('the same patient twice with the same doctor that day → 409 PATIENT_DOUBLE_BOOKED', async () => {
      const patient = await createPatient();
      const body = { patientId: patient.id, doctorId: doctor.id, serviceId };
      const post = () => api().post('/api/v1/appointments/walk-in').set(reception.auth).send(body);
      expect((await post()).status).toBe(201);
      expectErrorShape((await post()).body, 'PATIENT_DOUBLE_BOOKED');
    });

    it('only receptionists', async () => {
      const admin = await loginAs('admin');
      const res = await api()
        .post('/api/v1/appointments/walk-in')
        .set(admin.auth)
        .send({ patientId: (await createPatient()).id, doctorId: doctor.id, serviceId });
      expect(res.status).toBe(403);
    });
  });
});
