import { Appointment } from '../src/modules/appointments/model.js';
import { addDaysToDate } from '../src/utils/dates.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  at,
  createBookingSetup,
  createDoctor,
  createPatient,
  createSchedule,
  createService,
  nextWeekday,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Booking races (spec §8.2): requests fired in parallel. The booking lock (bookingVersion on
 * the doctor and the patient) serialises overlapping transactions; the partial unique index is
 * the last guard. Exactly one request may win each race.
 */

let reception: LoggedIn;
let setup: Awaited<ReturnType<typeof createBookingSetup>>;

const book = (body: Record<string, unknown>) =>
  api().post('/api/v1/appointments').set(reception.auth).send(body);

const statuses = (results: { status: number }[]) => results.map((r) => r.status).sort();
const codes = (results: { status: number; body: { error?: { code: string } } }[]) =>
  results.filter((r) => r.status >= 400).map((r) => r.body.error?.code);

describe('booking races', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    reception = await loginAs('receptionist');
    setup = await createBookingSetup();
  });
  afterEach(() => emails.restore());

  it('10 parallel bookings of the same slot → exactly one 201, nine 409 SLOT_UNAVAILABLE', async () => {
    const day = nextWeekday(2, 3);
    const patients = await Promise.all(Array.from({ length: 10 }, () => createPatient()));
    const results = await Promise.all(
      patients.map((p) =>
        book({
          patientId: p.id,
          doctorId: setup.doctorId,
          serviceId: setup.serviceId,
          startAt: at(day, '09:00'),
        }),
      ),
    );
    expect(statuses(results)).toEqual([201, ...Array(9).fill(409)]);
    expect(codes(results)).toEqual(Array(9).fill('SLOT_UNAVAILABLE'));
    expect(await Appointment.countDocuments({ isSlotActive: true })).toBe(1);
  }, 60_000);

  it('a 30-min service at 09:00 and a 15-min service at 09:15 in parallel → only one wins', async () => {
    const long = await createService({ durationMinutes: 30 });
    // Several rounds on different days: the outcome must never be two bookings.
    for (let round = 0; round < 5; round += 1) {
      const day = addDaysToDate(nextWeekday(1, 3), round); // Mon–Fri
      const [a, b] = await Promise.all([createPatient(), createPatient()]);
      const results = await Promise.all([
        book({
          patientId: a.id,
          doctorId: setup.doctorId,
          serviceId: long._id.toString(),
          startAt: at(day, '09:00'),
        }),
        book({
          patientId: b.id,
          doctorId: setup.doctorId,
          serviceId: setup.serviceId,
          startAt: at(day, '09:15'),
        }),
      ]);
      expect(statuses(results), `round ${round}`).toEqual([201, 409]);
      expect(codes(results)).toEqual(['SLOT_UNAVAILABLE']);
    }
    expect(await Appointment.countDocuments()).toBe(5);
  }, 60_000);

  it('the same patient with two doctors at the same time in parallel → only one wins', async () => {
    const other = await createDoctor();
    await createSchedule(other.id);
    for (let round = 0; round < 5; round += 1) {
      const day = addDaysToDate(nextWeekday(1, 3), round);
      const results = await Promise.all(
        [setup.doctorId, other.id].map((doctorId) =>
          book({
            patientId: setup.patient.id,
            doctorId,
            serviceId: setup.serviceId,
            startAt: at(day, '10:00'),
          }),
        ),
      );
      expect(statuses(results), `round ${round}`).toEqual([201, 409]);
      expect(codes(results)).toEqual(['PATIENT_DOUBLE_BOOKED']);
    }
  }, 60_000);

  it('two reschedules into the same free slot in parallel → only one wins', async () => {
    const day = nextWeekday(3, 3);
    const [a, b] = await Promise.all([createPatient(), createPatient()]);
    const booked = await Promise.all(
      [
        [a.id, '09:00'],
        [b.id, '09:15'],
      ].map(([patientId, time]) =>
        book({
          patientId,
          doctorId: setup.doctorId,
          serviceId: setup.serviceId,
          startAt: at(day, time!),
        }),
      ),
    );
    const results = await Promise.all(
      booked.map((r) =>
        api()
          .post(`/api/v1/appointments/${r.body.data.id}/reschedule`)
          .set(reception.auth)
          .send({ startAt: at(day, '11:00'), reason: 'Patient asked' }),
      ),
    );
    expect(statuses(results)).toEqual([200, 409]);
    expect(codes(results)).toEqual(['SLOT_UNAVAILABLE']);
    expect(await Appointment.countDocuments({ startAt: at(day, '11:00') })).toBe(1);
  }, 60_000);

  it('a booking racing a cancellation of the same slot never double-books', async () => {
    const day = nextWeekday(4, 3);
    const [a, b] = await Promise.all([createPatient(), createPatient()]);
    const first = await book({
      patientId: a.id,
      doctorId: setup.doctorId,
      serviceId: setup.serviceId,
      startAt: at(day, '09:00'),
    });
    const [cancel, second] = await Promise.all([
      api()
        .post(`/api/v1/appointments/${first.body.data.id}/cancel`)
        .set(reception.auth)
        .send({ reason: 'Patient called' }),
      book({
        patientId: b.id,
        doctorId: setup.doctorId,
        serviceId: setup.serviceId,
        startAt: at(day, '09:00'),
      }),
    ]);
    expect(cancel.status).toBe(200);
    expect([201, 409]).toContain(second.status);
    expect(await Appointment.countDocuments({ isSlotActive: true })).toBe(
      second.status === 201 ? 1 : 0,
    );
  }, 60_000);
});
