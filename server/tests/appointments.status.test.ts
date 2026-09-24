import { Appointment } from '../src/modules/appointments/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  at,
  createBookingSetup,
  createDoctor,
  createPatient,
  createSchedule,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  nextWeekday,
  setSettings,
  TEST_TZ,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** Reschedule and cancel (spec §4.5, §5.1, §8.3). */

let reception: LoggedIn;
let setup: Awaited<ReturnType<typeof createBookingSetup>>;
let day: string;

const book = (patientId: string, time: string, date = day, auth = reception.auth) =>
  api()
    .post('/api/v1/appointments')
    .set(auth)
    .send({
      patientId,
      doctorId: setup.doctorId,
      serviceId: setup.serviceId,
      startAt: at(date, time),
    });
const reschedule = (id: string, body: Record<string, unknown>, auth = reception.auth) =>
  api().post(`/api/v1/appointments/${id}/reschedule`).set(auth).send(body);
const cancel = (id: string, body: Record<string, unknown>, auth = reception.auth) =>
  api().post(`/api/v1/appointments/${id}/cancel`).set(auth).send(body);

/** An appointment of `patient` with the setup doctor starting `minutes` from now. */
const startingIn = (patient: string, minutes: number, status = 'scheduled') =>
  insertAppointment({
    patient,
    doctor: setup.doctorId,
    startAt: new Date(Date.now() + minutes * 60_000),
    status,
  });

describe('appointment status actions', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    reception = await loginAs('receptionist');
    setup = await createBookingSetup();
    day = nextWeekday(1, 3);
  });
  afterEach(() => emails.restore());

  describe('POST /appointments/:id/reschedule', () => {
    it('moves the appointment, records history, frees the old slot, audits and notifies', async () => {
      await Patient.updateOne({ _id: setup.patient.id }, { $set: { email: 'pat@example.com' } });
      const booked = await book(setup.patient.id, '09:00');
      const id = booked.body.data.id as string;
      const res = await reschedule(id, { startAt: at(day, '11:00'), reason: 'Patient asked' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        id,
        appointmentNumber: booked.body.data.appointmentNumber, // same appointment
        status: 'scheduled',
        startAt: at(day, '11:00').toISOString(),
        endAt: at(day, '11:15').toISOString(),
      });
      expect(res.body.data.rescheduleHistory).toEqual([
        expect.objectContaining({
          fromStartAt: at(day, '09:00').toISOString(),
          toStartAt: at(day, '11:00').toISOString(),
          by: reception.user._id.toString(),
          byRole: 'receptionist',
          reason: 'Patient asked',
        }),
      ]);
      // The old slot is free again.
      const other = await createPatient();
      expect((await book(other.id, '09:00')).status).toBe(201);

      const [entry] = await auditEntries('appointment.reschedule');
      expect(entry).toMatchObject({
        patient: setup.patient.patient._id,
        metadata: { reasonGiven: true },
      });
      await vi.waitFor(() =>
        expect(emails.sent.map((m) => m.subject)).toContain('Appointment rescheduled'),
      );
    });

    it('into a taken slot → 409 and the appointment keeps its old time and slot', async () => {
      const mine = await book(setup.patient.id, '09:00');
      const other = await createPatient();
      await book(other.id, '10:00');
      const res = await reschedule(mine.body.data.id, {
        startAt: at(day, '10:00'),
        reason: 'Patient asked',
      });
      expect(res.status).toBe(409);
      expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
      const stored = await Appointment.findById(mine.body.data.id).lean();
      expect(stored!.startAt).toEqual(at(day, '09:00'));
      expect(stored!.rescheduleHistory).toEqual([]);
      // The old slot is still held.
      const third = await createPatient();
      expectErrorShape((await book(third.id, '09:00')).body, 'SLOT_UNAVAILABLE');
    });

    it('to an overlapping time of its own (09:00 → 09:15 for a 15-min slot) is fine', async () => {
      const mine = await book(setup.patient.id, '09:00');
      const res = await reschedule(mine.body.data.id, {
        startAt: at(day, '09:15'),
        reason: 'Running late',
      });
      expect(res.status).toBe(200);
    });

    it('to another doctor on the same day', async () => {
      const other = await createDoctor();
      await createSchedule(other.id);
      const mine = await book(setup.patient.id, '09:00');
      const res = await reschedule(mine.body.data.id, {
        startAt: at(day, '09:00'),
        doctorId: other.id,
        reason: 'Doctor on call',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.doctor.id).toBe(other.id);
      expect(res.body.data.rescheduleHistory[0]).toMatchObject({
        fromDoctor: setup.doctorId,
        toDoctor: other.id,
      });
    });

    it('the same time again → 422', async () => {
      const mine = await book(setup.patient.id, '09:00');
      const res = await reschedule(mine.body.data.id, {
        startAt: at(day, '09:00'),
        reason: 'No change',
      });
      expect(res.status).toBe(422);
    });

    it('staff must give a reason', async () => {
      const mine = await book(setup.patient.id, '09:00');
      const res = await reschedule(mine.body.data.id, { startAt: at(day, '10:00') });
      expect(res.status).toBe(400);
      expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual([
        expect.objectContaining({ field: 'body.reason' }),
      ]);
    });

    it('a patient reschedules their own (no reason needed), outside the window', async () => {
      const me = await loginAsPatient();
      const mine = await book(me.patientId, '09:00', day, me.auth);
      const res = await reschedule(mine.body.data.id, { startAt: at(day, '10:00') }, me.auth);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.rescheduleHistory).toEqual([
        {
          fromStartAt: at(day, '09:00').toISOString(),
          toStartAt: at(day, '10:00').toISOString(),
          at: expect.any(String),
        },
      ]);
    });

    it('patients: not within minCancelHours of the current start → 422', async () => {
      const me = await loginAsPatient();
      const soon = await startingIn(me.patientId, 90); // default window: 2 h
      const res = await reschedule(soon._id.toString(), { startAt: at(day, '10:00') }, me.auth);
      expect(res.status).toBe(422);
      expectErrorShape(res.body, 'CANCELLATION_WINDOW_PASSED');
      // Staff can still move it.
      const staff = await reschedule(soon._id.toString(), {
        startAt: at(day, '10:00'),
        reason: 'Called in',
      });
      expect(staff.status).toBe(200);
    });

    it("patients: someone else's appointment → 404", async () => {
      const me = await loginAsPatient();
      const theirs = await book(setup.patient.id, '09:00');
      const res = await reschedule(theirs.body.data.id, { startAt: at(day, '10:00') }, me.auth);
      expect(res.status).toBe(404);
    });

    it('patients: the new time must be inside the booking window', async () => {
      await setSettings({ 'appointment.bookingWindowDays': 10 });
      const me = await loginAsPatient();
      const mine = await book(me.patientId, '09:00', day, me.auth);
      const far = nextWeekday(1, 12);
      const res = await reschedule(mine.body.data.id, { startAt: at(far, '09:00') }, me.auth);
      expectErrorShape(res.body, 'OUTSIDE_BOOKING_WINDOW');
    });

    it('only from scheduled: every other status → 409 INVALID_STATUS_TRANSITION', async () => {
      for (const status of ['checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']) {
        const appt = await startingIn(setup.patient.id, 60 * 24 * 5, status);
        const res = await reschedule(appt._id.toString(), {
          startAt: at(day, '10:00'),
          reason: 'Try it',
        });
        expect(res.status, status).toBe(409);
        expectErrorShape(res.body, 'INVALID_STATUS_TRANSITION');
      }
    });
  });

  describe('POST /appointments/:id/cancel', () => {
    it('frees the slot (bookable again), records who and why, audits and notifies', async () => {
      await Patient.updateOne({ _id: setup.patient.id }, { $set: { email: 'pat@example.com' } });
      const mine = await book(setup.patient.id, '09:00');
      const res = await cancel(mine.body.data.id, { reason: 'Patient called' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'cancelled',
        cancellation: {
          by: reception.user._id.toString(),
          byRole: 'receptionist',
          reason: 'Patient called',
        },
      });
      const stored = await Appointment.findById(mine.body.data.id).lean();
      expect(stored!.isSlotActive).toBe(false);
      expect(stored!.statusHistory.map((h) => h.status)).toEqual(['scheduled', 'cancelled']);

      const other = await createPatient();
      expect((await book(other.id, '09:00')).status).toBe(201);
      expect(await auditEntries('appointment.cancel')).toHaveLength(1);
      await vi.waitFor(() =>
        expect(emails.sent.map((m) => m.subject)).toContain('Appointment cancelled'),
      );
    });

    it('staff and doctors must give a reason', async () => {
      const mine = await book(setup.patient.id, '09:00');
      expect((await cancel(mine.body.data.id, {})).status).toBe(400);
      expect((await cancel(mine.body.data.id, { reason: '' })).status).toBe(400);
    });

    it('a checked-in appointment can be cancelled by staff (patient left)', async () => {
      const appt = await startingIn(setup.patient.id, 10, 'checked_in');
      const res = await cancel(appt._id.toString(), { reason: 'Patient left' });
      expect(res.status).toBe(200);
    });

    it('the patient cancels their own outside the window; not within it; not once checked in', async () => {
      const me = await loginAsPatient();
      const mine = await book(me.patientId, '09:00', day, me.auth);
      const res = await cancel(mine.body.data.id, {}, me.auth);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.cancellation).toEqual({
        at: expect.any(String),
        byYou: true,
        reason: null,
      });

      const soon = await startingIn(me.patientId, 60);
      expectErrorShape(
        (await cancel(soon._id.toString(), {}, me.auth)).body,
        'CANCELLATION_WINDOW_PASSED',
      );
      const arrived = await startingIn(me.patientId, 60 * 24 * 3, 'checked_in');
      expectErrorShape(
        (await cancel(arrived._id.toString(), {}, me.auth)).body,
        'CANCELLATION_WINDOW_PASSED',
      );
    });

    it("a patient cannot cancel someone else's appointment (404, audited, unchanged)", async () => {
      const me = await loginAsPatient();
      const theirs = await book(setup.patient.id, '09:00');
      const res = await cancel(theirs.body.data.id, {}, me.auth);
      expect(res.status).toBe(404);
      expect(await auditEntries('access.denied')).toHaveLength(1);
      expect((await Appointment.findById(theirs.body.data.id).lean())!.status).toBe('scheduled');
    });

    it('the window follows settings.appointment.minCancelHours', async () => {
      await setSettings({ 'appointment.minCancelHours': 24 });
      const me = await loginAsPatient();
      const tomorrowish = await startingIn(me.patientId, 60 * 20);
      expect((await cancel(tomorrowish._id.toString(), {}, me.auth)).status).toBe(422);
    });

    it("a doctor cancels their own appointment, not another doctor's (404)", async () => {
      const doctor = await loginAsDoctor();
      const own = await insertAppointment({
        patient: setup.patient.id,
        doctor: doctor.id,
        startAt: at(day, '09:00'),
      });
      const theirs = await book(setup.patient.id, '10:00');
      expect((await cancel(own._id.toString(), { reason: 'Emergency' }, doctor.auth)).status).toBe(
        200,
      );
      expect((await cancel(theirs.body.data.id, { reason: 'Emergency' }, doctor.auth)).status).toBe(
        404,
      );
    });

    it('cancelling twice → 409 INVALID_STATUS_TRANSITION', async () => {
      const mine = await book(setup.patient.id, '09:00');
      await cancel(mine.body.data.id, { reason: 'First' });
      const res = await cancel(mine.body.data.id, { reason: 'Second' });
      expect(res.status).toBe(409);
      expectErrorShape(res.body, 'INVALID_STATUS_TRANSITION');
    });

    it('from in consultation, completed, cancelled or no-show → 409', async () => {
      for (const status of ['in_consultation', 'completed', 'cancelled', 'no_show']) {
        const appt = await startingIn(setup.patient.id, 30, status);
        const res = await cancel(appt._id.toString(), { reason: 'Try it' });
        expect(res.status, status).toBe(409);
        expectErrorShape(res.body, 'INVALID_STATUS_TRANSITION');
      }
    });
  });

  describe('model guard', () => {
    it('an update that changes status must also set isSlotActive', async () => {
      const appt = await startingIn(setup.patient.id, 60 * 24);
      await expect(
        Appointment.updateOne({ _id: appt._id }, { $set: { status: 'cancelled' } }),
      ).rejects.toThrow(/isSlotActive/);
    });

    it('saving a document derives isSlotActive from status and isOverbook', async () => {
      const cancelled = await startingIn(setup.patient.id, 60, 'cancelled');
      expect(cancelled.isSlotActive).toBe(false);
      const overbook = await insertAppointment({
        patient: (await createPatient()).id,
        doctor: setup.doctorId,
        startAt: at(addDaysToDate(clinicToday(TEST_TZ), 1), '09:00'),
        isOverbook: true,
      });
      expect(overbook.isSlotActive).toBe(false);
    });
  });
});
