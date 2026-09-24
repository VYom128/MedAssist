import { Appointment } from '../src/modules/appointments/model.js';
import { addDaysToDate } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  at,
  createBookingSetup,
  createPatient,
  createSchedule,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  nextWeekday,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** GET /appointments, /appointments/calendar, /appointments/:id and PATCH (spec §7.8, §2.4). */

let reception: LoggedIn;
let doctor: LoggedIn & { id: string };
let me: LoggedIn & { patientId: string };
let setup: Awaited<ReturnType<typeof createBookingSetup>>;
let day: string;
/** Appointments: mine (patient `me`, doctor `doctor`), otherDoctors (setup doctor), stranger's. */
let ids: { mine: string; otherDoctors: string; strangers: string };

const get = (path: string, auth: { Authorization: string }) =>
  api().get(`/api/v1${path}`).set(auth);

describe('appointment reads', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    reception = await loginAs('receptionist');
    setup = await createBookingSetup();
    doctor = await loginAsDoctor();
    await createSchedule(doctor.id);
    me = await loginAsPatient({ firstName: 'Priya', lastName: 'Sharma' });
    day = nextWeekday(1, 3);
    const book = (patientId: string, doctorId: string, time: string, date = day) =>
      api()
        .post('/api/v1/appointments')
        .set(reception.auth)
        .send({ patientId, doctorId, serviceId: setup.serviceId, startAt: at(date, time) });
    const stranger = await createPatient({ firstName: 'Rahul', lastName: 'Verma' });
    ids = {
      mine: (await book(me.patientId, doctor.id, '09:00')).body.data.id,
      otherDoctors: (await book(me.patientId, setup.doctorId, '11:00')).body.data.id,
      strangers: (await book(stranger.id, doctor.id, '10:00', addDaysToDate(day, 1))).body.data.id,
    };
  });
  afterEach(() => emails.restore());

  describe('GET /appointments', () => {
    it('reception sees all, sorted by start', async () => {
      const res = await get('/appointments', reception.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([
        ids.mine,
        ids.otherDoctors,
        ids.strangers,
      ]);
      expect(res.body.meta).toMatchObject({ total: 3, page: 1 });
      expect(res.body.data[0].patient).toMatchObject({
        fullName: 'Priya Sharma',
        phone: expect.any(String),
      });
    });

    it('a doctor sees only their own (a doctor filter cannot widen it)', async () => {
      const res = await get('/appointments', doctor.auth);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([ids.mine, ids.strangers]);
      const widened = await get(`/appointments?doctor=${setup.doctorId}`, doctor.auth);
      expect(widened.body.data).toEqual([]);
    });

    it('a patient sees only their own, without a patient block', async () => {
      const res = await get('/appointments', me.auth);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([ids.mine, ids.otherDoctors]);
      expect(res.body.data[0].patient).toBeUndefined();
      expect(res.body.data[0].statusHistory).toBeUndefined();
    });

    it('a pending-link patient → 403 PATIENT_LINK_PENDING', async () => {
      const record = await createPatient();
      const pending = await loginAs('patient', {
        patient: record.id,
        patientLinkStatus: 'pending_verification',
      });
      expectErrorShape((await get('/appointments', pending.auth)).body, 'PATIENT_LINK_PENDING');
    });

    it('filters: clinic date range, doctor, patient, status (multi), type', async () => {
      const ids_ = (res: { body: { data: { id: string }[] } }) => res.body.data.map((a) => a.id);
      expect(ids_(await get(`/appointments?from=${day}&to=${day}`, reception.auth))).toEqual([
        ids.mine,
        ids.otherDoctors,
      ]);
      expect(ids_(await get(`/appointments?doctor=${setup.doctorId}`, reception.auth))).toEqual([
        ids.otherDoctors,
      ]);
      expect(ids_(await get(`/appointments?patient=${me.patientId}`, reception.auth))).toHaveLength(
        2,
      );
      await api()
        .post(`/api/v1/appointments/${ids.otherDoctors}/cancel`)
        .set(reception.auth)
        .send({ reason: 'Called' });
      expect(ids_(await get('/appointments?status=cancelled', reception.auth))).toEqual([
        ids.otherDoctors,
      ]);
      expect(
        ids_(await get('/appointments?status=scheduled,cancelled', reception.auth)),
      ).toHaveLength(3);
      expect(ids_(await get('/appointments?type=walk_in', reception.auth))).toEqual([]);
      expect((await get('/appointments?status=bogus', reception.auth)).status).toBe(400);
      expect(
        (await get(`/appointments?from=${day}&to=${addDaysToDate(day, -1)}`, reception.auth))
          .status,
      ).toBe(400);
    });

    it('q: appointment number for everyone; patient name/MRN for staff only', async () => {
      const number = (await Appointment.findById(ids.mine).lean())!.appointmentNumber;
      const byNumber = await get(`/appointments?q=${number.toLowerCase()}`, reception.auth);
      expect(byNumber.body.data.map((a: { id: string }) => a.id)).toEqual([ids.mine]);
      const byName = await get('/appointments?q=pri%20sha', reception.auth);
      expect(byName.body.data).toHaveLength(2);
      const doctorByName = await get('/appointments?q=rahul', doctor.auth);
      expect(doctorByName.body.data.map((a: { id: string }) => a.id)).toEqual([ids.strangers]);
      // Patients can search their own by number, never by name.
      expect((await get(`/appointments?q=${number}`, me.auth)).body.data).toHaveLength(1);
      expect((await get('/appointments?q=priya', me.auth)).body.data).toEqual([]);
    });

    it('pagination and sort', async () => {
      const res = await get('/appointments?limit=1&page=2&sort=-startAt', reception.auth);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([ids.otherDoctors]);
      expect(res.body.meta).toMatchObject({ total: 3, totalPages: 3 });
    });

    it('lab technicians are not allowed', async () => {
      expect((await get('/appointments', (await loginAs('labtech')).auth)).status).toBe(403);
    });
  });

  describe('GET /appointments/calendar', () => {
    it('compact events with a short patient name; doctors see their own', async () => {
      const q = `?from=${day}&to=${addDaysToDate(day, 6)}`;
      const res = await get(`/appointments/calendar${q}`, reception.auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0]).toEqual({
        id: ids.mine,
        appointmentNumber: expect.stringMatching(/^APT-/),
        startAt: at(day, '09:00').toISOString(),
        endAt: at(day, '09:15').toISOString(),
        status: 'scheduled',
        type: 'new',
        priority: 'normal',
        isOverbook: false,
        doctorId: doctor.id,
        patientShortName: 'Priya S.',
      });
      const own = await get(`/appointments/calendar${q}`, doctor.auth);
      expect(own.body.data.map((e: { id: string }) => e.id)).toEqual([ids.mine, ids.strangers]);
      const filtered = await get(
        `/appointments/calendar${q}&doctor=${setup.doctorId}`,
        reception.auth,
      );
      expect(filtered.body.data.map((e: { id: string }) => e.id)).toEqual([ids.otherDoctors]);
    });

    it('from/to are required and at most 31 days apart', async () => {
      expect((await get('/appointments/calendar', reception.auth)).status).toBe(400);
      const res = await get(
        `/appointments/calendar?from=${day}&to=${addDaysToDate(day, 31)}`,
        reception.auth,
      );
      expect(res.status).toBe(400);
      expect(
        (
          await get(
            `/appointments/calendar?from=${day}&to=${addDaysToDate(day, 30)}`,
            reception.auth,
          )
        ).status,
      ).toBe(200);
    });

    it('patients cannot use the calendar', async () => {
      expect((await get(`/appointments/calendar?from=${day}&to=${day}`, me.auth)).status).toBe(403);
    });
  });

  describe('GET /appointments/:id', () => {
    it('reception: full view with the patient phone and history', async () => {
      const res = await get(`/appointments/${ids.mine}`, reception.auth);
      expect(res.body.data).toMatchObject({
        patient: { fullName: 'Priya Sharma', phone: expect.any(String), age: expect.any(Number) },
        statusHistory: [expect.objectContaining({ status: 'scheduled' })],
        bookedBy: reception.user._id.toString(),
      });
    });

    it('doctor (own): minimal patient – name, MRN, age, sex – and the stated reason', async () => {
      const res = await get(`/appointments/${ids.mine}`, doctor.auth);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data.patient).sort()).toEqual(
        ['age', 'fullName', 'gender', 'id', 'mrn'].sort(),
      );
      expect(res.body.data).toHaveProperty('reason');
      expect(res.body.data.bookedBy).toBeUndefined();
    });

    it("doctor: another doctor's appointment → 404, audited as access.denied", async () => {
      const res = await get(`/appointments/${ids.otherDoctors}`, doctor.auth);
      expect(res.status).toBe(404);
      const [entry] = await auditEntries('access.denied');
      expect(entry).toMatchObject({ metadata: { reason: 'appointment_access' } });
    });

    it("patient: own without staff notes; someone else's → 404", async () => {
      const own = await get(`/appointments/${ids.mine}`, me.auth);
      expect(own.status).toBe(200);
      for (const key of ['patient', 'statusHistory', 'bookedBy', 'priority', 'queue']) {
        expect(own.body.data, key).not.toHaveProperty(key);
      }
      expect((await get(`/appointments/${ids.strangers}`, me.auth)).status).toBe(404);
    });

    it('unknown id → 404; malformed id → 400', async () => {
      expect((await get('/appointments/0123456789abcdef01234567', reception.auth)).status).toBe(
        404,
      );
      expect((await get('/appointments/nope', reception.auth)).status).toBe(400);
    });
  });

  describe('PATCH /appointments/:id', () => {
    const patch = (id: string, body: object, auth = reception.auth) =>
      api().patch(`/api/v1/appointments/${id}`).set(auth).send(body);

    it('changes reason and priority; audits the field names with the reason text redacted', async () => {
      const res = await patch(ids.mine, { priority: 'emergency', reason: 'Chest pain' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ priority: 'emergency', reason: 'Chest pain' });
      const [entry] = await auditEntries('appointment.update');
      expect(entry!.changes).toMatchObject({
        before: { reason: '[REDACTED]', priority: 'normal' },
        after: { reason: '[REDACTED]', priority: 'emergency' },
      });
      expect([...(entry!.changes!.fields ?? [])].sort()).toEqual(['priority', 'reason']);
      expect(JSON.stringify(entry)).not.toContain('Chest pain');
    });

    it('only reason and priority; at least one', async () => {
      expect((await patch(ids.mine, { startAt: at(day, '10:00') })).status).toBe(400);
      expect((await patch(ids.mine, {})).status).toBe(400);
    });

    it('not once in consultation, completed, cancelled or no-show → 422', async () => {
      const done = await insertAppointment({
        patient: me.patientId,
        doctor: doctor.id,
        startAt: at(addDaysToDate(day, -10), '09:00'),
        status: 'completed',
      });
      expect((await patch(done._id.toString(), { priority: 'priority' })).status).toBe(422);
    });

    it('doctors and patients may not patch', async () => {
      expect((await patch(ids.mine, { priority: 'priority' }, doctor.auth)).status).toBe(403);
      expect((await patch(ids.mine, { priority: 'priority' }, me.auth)).status).toBe(403);
    });
  });
});
