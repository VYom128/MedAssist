import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { User } from '../src/modules/users/model.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { auditEntries, createUser, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  at,
  createBookingSetup,
  createDepartment,
  createDoctor,
  createPatient,
  createSchedule,
  createService,
  insertAppointment,
  loginAsPatient,
  nextWeekday,
  setSettings,
  TEST_TZ,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** POST /appointments (spec §4.5, §8.2). */

let reception: LoggedIn;
let setup: Awaited<ReturnType<typeof createBookingSetup>>;
let day: string; // a Monday a few days ahead

const book = (body: Record<string, unknown>, auth = reception.auth) =>
  api().post('/api/v1/appointments').set(auth).send(body);
const bodyFor = (time: string, extra: Record<string, unknown> = {}, date = day) => ({
  patientId: setup.patient.id,
  doctorId: setup.doctorId,
  serviceId: setup.serviceId,
  startAt: at(date, time).toISOString(),
  ...extra,
});

describe('POST /appointments', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init(); // the partial unique index must exist
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    reception = await loginAs('receptionist');
    setup = await createBookingSetup();
    day = nextWeekday(1, 3);
  });
  afterEach(() => emails.restore());

  it('reception books a slot: numbered, snapshotted, audited, patient emailed', async () => {
    await Patient.updateOne({ _id: setup.patient.id }, { $set: { email: 'pat@example.com' } });
    const res = await book(bodyFor('09:00', { reason: 'Fever for 3 days' }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const year = clinicToday(TEST_TZ).slice(0, 4);
    expect(res.body.data).toMatchObject({
      appointmentNumber: `APT-${year}-000001`,
      status: 'scheduled',
      type: 'new',
      source: 'reception',
      reason: 'Fever for 3 days',
      startAt: at(day, '09:00').toISOString(),
      endAt: at(day, '09:15').toISOString(),
      doctor: { id: setup.doctorId },
      service: {
        id: setup.serviceId,
        name: 'Consultation',
        durationMinutes: 15,
        pricePaise: 50_000,
      },
      patient: { id: setup.patient.id, mrn: setup.patient.patient.mrn },
      priority: 'normal',
      isOverbook: false,
    });
    const stored = await Appointment.findById(res.body.data.id).lean();
    expect(stored).toMatchObject({ isSlotActive: true, bookedBy: reception.user._id });
    expect(stored!.statusHistory).toMatchObject([{ status: 'scheduled' }]);
    // The booking lock was taken on both documents.
    expect((await DoctorProfile.findOne({ user: setup.doctorId }).lean())!.bookingVersion).toBe(1);
    expect((await Patient.findById(setup.patient.id).lean())!.bookingVersion).toBe(1);

    const [entry] = await auditEntries('appointment.create');
    expect(entry).toMatchObject({
      patient: setup.patient.patient._id,
      resource: { type: 'appointment', number: `APT-${year}-000001` },
    });
    await vi.waitFor(() => expect(emails.sent.map((m) => m.to)).toContain('pat@example.com'));
    const email = emails.sent.find((m) => m.to === 'pat@example.com')!;
    expect(email.subject).toBe('Appointment confirmed');
    expect(email.text).toContain(`APT-${year}-000001`);
    // No clinical or identifying details in the email (spec §10.3).
    expect(email.text).not.toMatch(/Fever|Consultation|Tester|Dr/);
  });

  it('numbers appointments in sequence', async () => {
    await book(bodyFor('09:00'));
    const other = await createPatient();
    const res = await book(bodyFor('09:15', { patientId: other.id }));
    expect(res.body.data.appointmentNumber).toMatch(/-000002$/);
  });

  it('a patient books for themselves (source patient_portal)', async () => {
    const me = await loginAsPatient();
    const res = await book(
      { doctorId: setup.doctorId, serviceId: setup.serviceId, startAt: at(day, '10:00') },
      me.auth,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ source: 'patient_portal' });
    expect(res.body.data.patient).toBeUndefined(); // patient view
    expect((await Appointment.findById(res.body.data.id).lean())!.patient.toString()).toBe(
      me.patientId,
    );
  });

  it("a patient cannot book for someone else's record (404, audited)", async () => {
    const me = await loginAsPatient();
    const res = await book(bodyFor('10:00'), me.auth);
    expect(res.status).toBe(404);
    expect(await auditEntries('access.denied')).toHaveLength(1);
    expect(await Appointment.countDocuments()).toBe(0);
  });

  it('staff must send patientId', async () => {
    const { patientId: _p, ...body } = bodyFor('09:00');
    const res = await book(body);
    expect(res.status).toBe(400);
    expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual([
      { field: 'body.patientId', message: 'Required' },
    ]);
  });

  it('an admin may book too (spec §7.8)', async () => {
    const admin = await loginAs('admin');
    expect((await book(bodyFor('09:00'), admin.auth)).status).toBe(201);
  });

  it('rejects bad input: no offset on startAt, unknown fields, followUpOf without follow_up', async () => {
    expect((await book({ ...bodyFor('09:00'), startAt: `${day}T09:00:00` })).status).toBe(400);
    expect((await book({ ...bodyFor('09:00'), status: 'completed' })).status).toBe(400);
    const res = await book({ ...bodyFor('09:00'), followUpOf: setup.doctorId });
    expect(res.status).toBe(400);
  });

  describe('slot validity', () => {
    it('a time that is not a slot start → 409 SLOT_UNAVAILABLE', async () => {
      for (const time of ['09:07', '14:00', '12:59', '08:45']) {
        const res = await book(bodyFor(time));
        expect(res.status, time).toBe(409);
        expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
      }
    });

    it('a service that would run past the session end → 409', async () => {
      const long = await createService({ durationMinutes: 30 });
      const res = await book(bodyFor('12:45', { serviceId: long._id.toString() }));
      expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
    });

    it('a non-working day (Sunday) → 409 SLOT_UNAVAILABLE', async () => {
      const sunday = nextWeekday(0, 3);
      const res = await book(bodyFor('09:00', {}, sunday));
      expect(res.status).toBe(409);
      expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
    });

    it('doctor on leave → 409 DOCTOR_UNAVAILABLE', async () => {
      await DoctorLeave.create({
        doctor: setup.doctorId,
        startAt: at(day, '08:00'),
        endAt: at(day, '10:00'),
      });
      const res = await book(bodyFor('09:30'));
      expectErrorShape(res.body, 'DOCTOR_UNAVAILABLE');
      expect((await book(bodyFor('10:00'))).status).toBe(201); // after the leave ends
    });

    it('cancelled leave does not block', async () => {
      await DoctorLeave.create({
        doctor: setup.doctorId,
        startAt: at(day, '08:00'),
        endAt: at(day, '10:00'),
        isCancelled: true,
      });
      expect((await book(bodyFor('09:30'))).status).toBe(201);
    });

    it('doctor not accepting appointments or inactive → 409 DOCTOR_UNAVAILABLE', async () => {
      await DoctorProfile.updateOne(
        { user: setup.doctorId },
        { $set: { isAcceptingAppointments: false } },
      );
      expectErrorShape((await book(bodyFor('09:00'))).body, 'DOCTOR_UNAVAILABLE');
      await DoctorProfile.updateOne(
        { user: setup.doctorId },
        { $set: { isAcceptingAppointments: true } },
      );
      await User.updateOne({ _id: setup.doctorId }, { $set: { isActive: false } });
      expectErrorShape((await book(bodyFor('09:00'))).body, 'DOCTOR_UNAVAILABLE');
    });

    it('unknown doctor or patient → 404', async () => {
      const labtech = await createUser('labtech');
      expect((await book(bodyFor('09:00', { doctorId: labtech._id.toString() }))).status).toBe(404);
      expect((await book(bodyFor('09:00', { patientId: '0123456789abcdef01234567' }))).status).toBe(
        404,
      );
    });

    it('inactive patient record → 422', async () => {
      await Patient.updateOne({ _id: setup.patient.id }, { $set: { isActive: false } });
      expectErrorShape((await book(bodyFor('09:00'))).body, 'BUSINESS_RULE_VIOLATION');
    });

    it('inactive service → 404; a service of another department → 422', async () => {
      const inactive = await createService({ isActive: false });
      expect((await book(bodyFor('09:00', { serviceId: inactive._id.toString() }))).status).toBe(
        404,
      );
      const otherDept = await createService({ department: (await createDepartment())._id });
      const res = await book(bodyFor('09:00', { serviceId: otherDept._id.toString() }));
      expect(res.status).toBe(422);
    });
  });

  describe('clashes (spec §8.2)', () => {
    it('doctor clash: the same slot twice → 409 SLOT_UNAVAILABLE', async () => {
      expect((await book(bodyFor('09:00'))).status).toBe(201);
      const other = await createPatient();
      const res = await book(bodyFor('09:00', { patientId: other.id }));
      expect(res.status).toBe(409);
      const body = expectErrorShape(res.body, 'SLOT_UNAVAILABLE');
      expect(body.message).toBe('This slot was just taken. Please pick another time.');
    });

    it('doctor clash: a 15-min slot inside an earlier 30-min appointment', async () => {
      const long = await createService({ durationMinutes: 30 });
      expect((await book(bodyFor('09:00', { serviceId: long._id.toString() }))).status).toBe(201);
      const other = await createPatient();
      expectErrorShape(
        (await book(bodyFor('09:15', { patientId: other.id }))).body,
        'SLOT_UNAVAILABLE',
      );
      expect((await book(bodyFor('09:30', { patientId: other.id }))).status).toBe(201);
    });

    it('patient clash with another doctor → 409 PATIENT_DOUBLE_BOOKED', async () => {
      const other = await createDoctor();
      await createSchedule(other.id);
      expect((await book(bodyFor('09:00'))).status).toBe(201);
      const res = await book(bodyFor('09:00', { doctorId: other.id }));
      expect(res.status).toBe(409);
      expect(expectErrorShape(res.body, 'PATIENT_DOUBLE_BOOKED').message).toBe(
        'The patient already has an appointment at that time',
      );
    });

    it('patient clash: an overlapping (not identical) time with another doctor', async () => {
      const other = await createDoctor();
      await createSchedule(other.id);
      const long = await createService({ durationMinutes: 30 });
      expect((await book(bodyFor('09:00', { serviceId: long._id.toString() }))).status).toBe(201);
      expectErrorShape(
        (await book(bodyFor('09:15', { doctorId: other.id }))).body,
        'PATIENT_DOUBLE_BOOKED',
      );
      // 09:30 starts when the first one ends: no overlap.
      expect((await book(bodyFor('09:30', { doctorId: other.id }))).status).toBe(201);
    });

    it('same doctor, same clinic day → 409 PATIENT_DOUBLE_BOOKED', async () => {
      expect((await book(bodyFor('09:00'))).status).toBe(201);
      const res = await book(bodyFor('12:00'));
      expectErrorShape(res.body, 'PATIENT_DOUBLE_BOOKED');
      expect(res.body.message).toBe(
        'The patient already has an appointment with this doctor that day',
      );
      // The next day is fine.
      expect((await book(bodyFor('12:00', {}, addDaysToDate(day, 1)))).status).toBe(201);
    });

    it('cancelled and no-show appointments do not clash', async () => {
      await insertAppointment({
        patient: setup.patient.id,
        doctor: setup.doctorId,
        startAt: at(day, '09:00'),
        status: 'cancelled',
      });
      await insertAppointment({
        patient: setup.patient.id,
        doctor: setup.doctorId,
        startAt: at(day, '09:00'),
        status: 'no_show',
      });
      expect((await book(bodyFor('09:00'))).status).toBe(201);
    });
  });

  describe('patient rules', () => {
    it('booking limit: maxActiveBookingsPerPatient upcoming bookings (patients only)', async () => {
      await setSettings({ 'appointment.maxActiveBookingsPerPatient': 2 });
      const me = await loginAsPatient();
      const mine = (date: string) =>
        book(
          { doctorId: setup.doctorId, serviceId: setup.serviceId, startAt: at(date, '09:00') },
          me.auth,
        );
      expect((await mine(day)).status).toBe(201);
      expect((await mine(addDaysToDate(day, 1))).status).toBe(201);
      const res = await mine(addDaysToDate(day, 2));
      expect(res.status).toBe(422);
      expectErrorShape(res.body, 'BOOKING_LIMIT_REACHED');
      // Reception may still book for the patient.
      const staff = await book({
        ...bodyFor('09:00', {}, addDaysToDate(day, 2)),
        patientId: me.patientId,
      });
      expect(staff.status).toBe(201);
    });

    it('booking window: patients up to bookingWindowDays ahead; staff further', async () => {
      await setSettings({ 'appointment.bookingWindowDays': 10 });
      const me = await loginAsPatient();
      const far = nextWeekday(1, 12);
      const res = await book(
        { doctorId: setup.doctorId, serviceId: setup.serviceId, startAt: at(far, '09:00') },
        me.auth,
      );
      expect(res.status).toBe(422);
      expectErrorShape(res.body, 'OUTSIDE_BOOKING_WINDOW');
      expect((await book(bodyFor('09:00', {}, far))).status).toBe(201);
    });

    it('nobody books in the past → 422 OUTSIDE_BOOKING_WINDOW', async () => {
      const yesterday = addDaysToDate(clinicToday(TEST_TZ), -1);
      expectErrorShape(
        (await book(bodyFor('09:00', {}, yesterday))).body,
        'OUTSIDE_BOOKING_WINDOW',
      );
    });

    it('self-booking disabled → 403 SELF_BOOKING_DISABLED (staff still book)', async () => {
      await setSettings({ 'appointment.allowPatientSelfBooking': false });
      const me = await loginAsPatient();
      const res = await book(
        { doctorId: setup.doctorId, serviceId: setup.serviceId, startAt: at(day, '09:00') },
        me.auth,
      );
      expect(res.status).toBe(403);
      expectErrorShape(res.body, 'SELF_BOOKING_DISABLED');
      expect((await book(bodyFor('09:00'))).status).toBe(201);
    });

    it('a pending-link patient → 403 PATIENT_LINK_PENDING', async () => {
      const record = await createPatient();
      const pending = await loginAs('patient', {
        patient: record.id,
        patientLinkStatus: 'pending_verification',
      });
      const res = await book(
        { doctorId: setup.doctorId, serviceId: setup.serviceId, startAt: at(day, '09:00') },
        pending.auth,
      );
      expect(res.status).toBe(403);
      expectErrorShape(res.body, 'PATIENT_LINK_PENDING');
    });
  });

  describe('follow-ups', () => {
    it("followUpOf must be the same patient's completed appointment", async () => {
      const done = await insertAppointment({
        patient: setup.patient.id,
        doctor: setup.doctorId,
        startAt: at(addDaysToDate(clinicToday(TEST_TZ), -7), '09:00'),
        status: 'completed',
      });
      const res = await book(
        bodyFor('09:00', { type: 'follow_up', followUpOf: done._id.toString() }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ type: 'follow_up', followUpOf: done._id.toString() });

      const other = await createPatient();
      const bad = await book(
        bodyFor('10:00', {
          patientId: other.id,
          type: 'follow_up',
          followUpOf: done._id.toString(),
        }),
      );
      expect(bad.status).toBe(422);
    });
  });

  it('the partial unique index exists', async () => {
    const indexes = await Appointment.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { doctor: 1, startAt: 1 },
        unique: true,
        partialFilterExpression: { isSlotActive: true },
      }),
    );
  });
});
