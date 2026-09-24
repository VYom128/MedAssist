import type { Role } from '../src/config/constants.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Department } from '../src/modules/departments/model.js';
import { LabTest } from '../src/modules/labTests/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Service } from '../src/modules/services/model.js';
import { User } from '../src/modules/users/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { createUser, loginAs, resetDb, TEST_PASSWORD } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  addDoctorProfile,
  at,
  createDoctor,
  createPatient,
  createSchedule,
  insertAppointment,
  nextWeekday,
} from './helpers/fixtures.js';
import { addDaysToDate, clinicToday, startOfClinicDay } from '../src/utils/dates.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { ensureEncounterDraft } from '../src/modules/encounters/draft.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { withTransaction } from '../src/utils/transaction.js';
import {
  ALL,
  ENDPOINTS,
  letters,
  PUBLIC_ENDPOINTS,
  routeKey,
  type Ctx,
  type Row,
} from './helpers/rbacMatrix.js';
import { api } from './helpers/testApp.js';

/**
 * RBAC matrix (spec §2.4, §15.1): every row of tests/helpers/rbacMatrix.ts × every role. A role
 * in `roles` must get exactly `status`; every other role gets 403.
 */

let n = 0;

async function buildContext(role: Role): Promise<Ctx> {
  n += 1;
  const me = await loginAs(role);
  const second = await api()
    .post('/api/v1/auth/login')
    .send({ email: me.user.email, password: TEST_PASSWORD });
  const target = await createUser('labtech');
  const inactive = await createUser('labtech', { isActive: false });
  const [department, inactiveDepartment] = await Department.create([
    { name: `Dept ${n}`, code: `D${letters(n)}` },
    { name: `Old dept ${n}`, code: `O${letters(n)}`, isActive: false },
  ]);
  const [service, inactiveService] = await Service.create([
    { code: `S-${n}`, name: 'Service', type: 'other', pricePaise: 100 },
    { code: `OS-${n}`, name: 'Old service', type: 'other', pricePaise: 100, isActive: false },
  ]);
  // Doctors get their own department, so `departmentId` can still be deactivated. Each code
  // family starts with its own letter (D…, O…, X…), so codes never collide as `n` grows.
  const doctorDepartment = (
    await Department.create({ name: `Doctors ${n}`, code: `X${letters(n)}` })
  )._id;
  if (role === 'doctor') await addDoctorProfile(me.user._id, { department: doctorDepartment });
  const doctorId =
    role === 'doctor'
      ? me.user._id.toString()
      : (await createDoctor({}, { department: doctorDepartment })).id;
  const other = await createDoctor({}, { department: doctorDepartment });
  const leave = await DoctorLeave.create({
    doctor: doctorId,
    startAt: new Date(Date.now() + 30 * 86_400_000),
    endAt: new Date(Date.now() + 31 * 86_400_000),
  });
  const labTest = { category: 'other', sampleType: 'blood', pricePaise: 100 };
  const [lab, inactiveLab] = await LabTest.create([
    { ...labTest, code: `LT-A${n}`, name: 'Lab test' },
    { ...labTest, code: `LT-B${n}`, name: 'Old lab test', isActive: false },
  ]);
  const patient = await createPatient();
  const otherPatient = await createPatient();
  const inactivePatient = await createPatient({ isActive: false });
  const invitable = await createPatient({ email: `invite${n}@example.com` });
  const pendingPatient = await createPatient({ dateOfBirth: '1991-02-03' });
  const pendingUser = await createUser('patient', {
    patient: pendingPatient.id,
    patientLinkStatus: 'pending_verification',
    dateOfBirth: new Date('1991-02-03T00:00:00Z'),
  });
  if (role === 'patient') {
    await User.updateOne(
      { _id: me.user._id },
      { $set: { patient: patient.id, patientLinkStatus: 'linked' } },
    );
    await Patient.updateOne({ _id: patient.id }, { $set: { user: me.user._id } });
  }
  // A bookable doctor (09:00–13:00 daily) and a scheduled appointment of `patient` with them.
  // Works all day, so a walk-in always finds a running session (except 23:55–24:00 IST).
  await createSchedule(doctorId, [{ start: '00:00', end: '23:55' }]);
  const appointmentDate = nextWeekday(2, 3); // a Tuesday
  const appointment = await insertAppointment({
    patient: patient.id,
    doctor: doctorId,
    startAt: at(appointmentDate, '09:00'),
    service: service!._id,
  });
  // Today's queue: minutes after clinic midnight, so each has already started.
  const today = clinicToday('Asia/Kolkata');
  const todayAt = (minutes: number, date = today) =>
    new Date(startOfClinicDay(date, 'Asia/Kolkata').getTime() + minutes * 60_000);
  const todays = async (minutes: number, status: string, extra: Record<string, unknown> = {}) =>
    insertAppointment({
      patient: (extra.patient as string | undefined) ?? (await createPatient()).id,
      doctor: doctorId,
      startAt: todayAt(minutes, (extra.date as string | undefined) ?? today),
      status,
      minutes: 1, // one minute each, so they do not overlap
      service: service!._id,
      queue: status === 'scheduled' ? {} : { tokenNumber: minutes, checkedInAt: todayAt(minutes) },
    });
  const todayScheduled = await todays(1, 'scheduled');
  const checkedIn = await todays(2, 'checked_in', { patient: patient.id });
  const noShow = await todays(3, 'no_show');
  const inConsultation = await todays(4, 'in_consultation', {
    date: addDaysToDate(today, -1),
  });
  const walkInPatient = await createPatient();
  const encounter = await withTransaction((session) =>
    ensureEncounterDraft(inConsultation, { by: doctorId, year: 2026, session }),
  );
  // Phase 5 step 2: a note ready to sign, two signed notes, an issued and a reissued prescription.
  const note = async (appt: Parameters<typeof ensureEncounterDraft>[0], status = 'draft') => {
    const e = await withTransaction((session) =>
      ensureEncounterDraft(appt, { by: doctorId, year: 2026, session }),
    );
    await Encounter.collection.updateOne(
      { _id: e.id },
      {
        $set: {
          status,
          chiefComplaint: 'Matrix complaint',
          diagnoses: [{ description: 'Matrix diagnosis', type: 'provisional', isPrimary: true }],
          ...(status === 'signed' ? { signedAt: new Date(), signedBy: doctorId } : {}),
        },
      },
    );
    return e.id;
  };
  const signable = await note(
    await todays(5, 'in_consultation', { date: addDaysToDate(today, -1) }),
  );
  const past = (days: number) =>
    insertAppointment({
      patient: patient.id,
      doctor: doctorId,
      startAt: new Date(Date.now() - days * 86_400_000),
      status: 'completed',
      isSlotActive: false,
      service: service!._id,
    });
  const signedAppt = await past(3);
  const signedEncounter = await note(signedAppt, 'signed');
  const rxItems = [
    { drugName: 'Paracetamol', dose: '1 tablet', frequency: 'TDS', durationDays: 3 },
  ];
  const rxBase = {
    patient: patient.id,
    doctor: doctorId,
    items: rxItems,
  };
  const prescription = await Prescription.create({
    ...rxBase,
    encounter: signedEncounter,
    appointment: signedAppt._id,
    status: 'issued',
    prescriptionNumber: `RX-1999-${String(n).padStart(6, '0')}`,
    issuedAt: new Date(),
  });
  const otherAppt = await past(5);
  const otherSigned = await note(otherAppt, 'signed');
  const [cancelledRx] = await Prescription.create([
    {
      ...rxBase,
      encounter: otherSigned,
      appointment: otherAppt._id,
      status: 'cancelled',
      isCurrent: false,
      prescriptionNumber: `RX-1998-${String(n).padStart(6, '0')}`,
    },
  ]);
  const reissued = await Prescription.create({
    ...rxBase,
    encounter: otherSigned,
    appointment: otherAppt._id,
    replaces: cancelledRx!._id,
  });
  return {
    me,
    targetId: target._id.toString(),
    inactiveId: inactive._id.toString(),
    otherSessionId: verifyAccessToken(second.body.data.accessToken).sid,
    departmentId: department!._id.toString(),
    inactiveDepartmentId: inactiveDepartment!._id.toString(),
    serviceId: service!._id.toString(),
    inactiveServiceId: inactiveService!._id.toString(),
    doctorId,
    otherDoctorId: other.id,
    leaveId: leave._id.toString(),
    labTestId: lab!._id.toString(),
    inactiveLabTestId: inactiveLab!._id.toString(),
    patientId: patient.id,
    otherPatientId: otherPatient.id,
    inactivePatientId: inactivePatient.id,
    invitablePatientId: invitable.id,
    pendingUserId: pendingUser._id.toString(),
    pendingPatientId: pendingPatient.id,
    appointmentId: appointment._id.toString(),
    appointmentDate,
    bookStartAt: at(addDaysToDate(appointmentDate, 1), '10:00').toISOString(),
    rescheduleStartAt: at(appointmentDate, '11:00').toISOString(),
    todayScheduledId: todayScheduled._id.toString(),
    checkedInId: checkedIn._id.toString(),
    queueAppointmentId: checkedIn._id.toString(),
    noShowId: noShow._id.toString(),
    inConsultationId: inConsultation._id.toString(),
    walkInPatientId: walkInPatient.id,
    encounterId: encounter.id.toString(),
    signableEncounterId: signable.toString(),
    signedEncounterId: signedEncounter.toString(),
    prescriptionId: prescription._id.toString(),
    reissuedDraftId: reissued._id.toString(),
    n,
  };
}

const send = (row: Row, c: Ctx | null) => {
  const zero = '0'.repeat(24);
  const ctx =
    c ??
    ({
      targetId: zero,
      inactiveId: zero,
      otherSessionId: zero,
      departmentId: zero,
      inactiveDepartmentId: zero,
      serviceId: zero,
      inactiveServiceId: zero,
      doctorId: zero,
      otherDoctorId: zero,
      leaveId: zero,
      labTestId: zero,
      inactiveLabTestId: zero,
      patientId: zero,
      otherPatientId: zero,
      inactivePatientId: zero,
      invitablePatientId: zero,
      pendingUserId: zero,
      pendingPatientId: zero,
      appointmentId: zero,
      appointmentDate: '2030-01-01',
      bookStartAt: '2030-01-01T04:30:00.000Z',
      rescheduleStartAt: '2030-01-01T05:30:00.000Z',
      todayScheduledId: zero,
      checkedInId: zero,
      queueAppointmentId: zero,
      noShowId: zero,
      inConsultationId: zero,
      walkInPatientId: zero,
      encounterId: zero,
      signableEncounterId: zero,
      signedEncounterId: zero,
      prescriptionId: zero,
      reissuedDraftId: zero,
      n: 0,
    } as Ctx);
  let req = api()[row.method](`/api/v1${row.path(ctx)}`);
  if (c) req = req.set(c.me.auth);
  if (row.body) req = req.send(row.body(ctx));
  return req;
};

/** Keys a public (no token) response must never contain. */
const PRIVATE_KEYS =
  /"(email|phone|registrationNumber|roomNumber|slotMinutes|gstin|invoicePrefix|isActive|activeDoctors|lockVersion|bookingVersion|createdBy|updatedBy|passwordHash)"/;

/**
 * The kiosk board shows doctor names and rooms (spec §4.6) but nothing about patients and no ids.
 */
const PRIVATE_BOARD_KEYS =
  /"(id|_id|\w*Id|email|phone|mrn|patient\w*|firstName|lastName|appointment\w*|registrationNumber|isActive|createdBy|updatedBy)"/;

/** Public clinic settings include the clinic's own contact email/phone (spec §7.4), nothing else. */
const PRIVATE_SETTINGS_KEYS =
  /"(registrationNumber|gstin|invoicePrefix|defaultTaxRateBps|requireDualVerification|updatedBy)"/;

/** Audit entries other than denials, after queued writes finish. */
async function auditCount() {
  await flushAudit();
  return AuditLog.countDocuments({ action: { $ne: 'access.denied' } });
}

describe('RBAC matrix', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Promise.all([Appointment.init(), Encounter.init(), Prescription.init()]);
    await resetDb();
    emails = captureEmails(); // welcome and reset emails are sent in the background
  });
  afterAll(() => emails.restore());

  for (const row of ENDPOINTS) {
    for (const role of ALL) {
      const allowed = row.roles.includes(role);
      const expected = allowed ? (row.statusFor?.[role] ?? row.status) : 403;
      const label = routeKey(row);
      it(`${label} as ${role} → ${expected}`, async () => {
        const c = await buildContext(role);
        const before = await auditCount();
        const res = await send(row, c);
        expect(res.status, JSON.stringify(res.body)).toBe(expected);
        // Every write an allowed role makes is audited (spec §10.4).
        if (allowed && expected < 400 && row.method !== 'get') {
          expect(await auditCount(), `${label} wrote no audit entry`).toBeGreaterThan(before);
        }
      });
    }
  }

  for (const row of PUBLIC_ENDPOINTS) {
    for (const role of [...ALL, 'anonymous'] as const) {
      it(`public ${routeKey(row)} as ${role} → ${row.status}`, async () => {
        const c = await buildContext(role === 'anonymous' ? 'patient' : role);
        let req = api()[row.method](`/api/v1${row.path(c)}`);
        if (role !== 'anonymous') req = req.set(c.me.auth);
        const res = await req;
        expect(res.status, JSON.stringify(res.body)).toBe(row.status);
        if (role === 'anonymous') {
          // Public responses never carry contact details, registration numbers or admin fields.
          const privateKeys =
            routeKey(row) === 'GET /settings/public'
              ? PRIVATE_SETTINGS_KEYS
              : routeKey(row) === 'GET /queue/board'
                ? PRIVATE_BOARD_KEYS
                : PRIVATE_KEYS;
          expect(JSON.stringify(res.body)).not.toMatch(privateKeys);
        }
      });
    }
  }

  it('every protected endpoint returns 401 without a token', async () => {
    for (const row of ENDPOINTS) {
      const res = await send(row, null);
      expect(res.status, `${row.method} ${row.path({} as Ctx)}`).toBe(401);
    }
  });
});
