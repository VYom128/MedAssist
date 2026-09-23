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
import { addDoctorProfile, createDoctor, createPatient } from './helpers/fixtures.js';
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
  // Doctors get their own department, so `departmentId` can still be deactivated.
  const doctorDepartment = (
    await Department.create({ name: `Doctors ${n}`, code: `DR${letters(n)}` })
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
      n: 0,
    } as Ctx);
  let req = api()[row.method](`/api/v1${row.path(ctx)}`);
  if (c) req = req.set(c.me.auth);
  if (row.body) req = req.send(row.body(ctx));
  return req;
};

/** Keys a public (no token) response must never contain. */
const PRIVATE_KEYS =
  /"(email|phone|registrationNumber|roomNumber|slotMinutes|gstin|invoicePrefix|isActive|activeDoctors|lockVersion|createdBy|updatedBy|passwordHash)"/;

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
            routeKey(row) === 'GET /settings/public' ? PRIVATE_SETTINGS_KEYS : PRIVATE_KEYS;
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
