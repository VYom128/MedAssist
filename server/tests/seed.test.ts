import { AuditLog } from '../src/modules/audit/model.js';
import { Department } from '../src/modules/departments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { LabTest } from '../src/modules/labTests/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { Service } from '../src/modules/services/model.js';
import { ClinicSettings } from '../src/modules/settings/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { User } from '../src/modules/users/model.js';
import { doctorSeeds } from '../src/seed/data/clinic.js';
import { demoLogins, demoLoginTable, runSeed, summaryTable } from '../src/seed/index.js';
import { patientSeeds } from '../src/seed/data/patients.js';
import { PENDING_SIGNUP_EMAIL, patientLogins } from '../src/seed/patients.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../src/seed/users.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api } from './helpers/testApp.js';

describe('seed', () => {
  beforeAll(() => Promise.all([DoctorProfile.init(), DoctorSchedule.init()]));
  beforeEach(resetDb);

  it('builds a configured clinic', async () => {
    const emails = captureEmails();
    const summary = await runSeed();
    expect(summary).toEqual({
      users: { created: DEMO_ACCOUNTS.length, updated: 0 },
      settings: { created: 0, updated: 1, unchanged: 0 },
      departments: { created: 5, updated: 0, unchanged: 0 },
      services: { created: 12, updated: 0, unchanged: 0 },
      doctors: { created: 8, updated: 0, unchanged: 0, schedules: 8, leaves: 2 },
      labTests: { created: 15, updated: 0, unchanged: 0 },
      patients: { created: 60, updated: 0, unchanged: 0, portalUsers: 8, pending: 1 },
    });

    const settings = await ClinicSettings.findOne().lean();
    expect(settings).toMatchObject({
      name: 'MedAssist Clinic',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      workingDays: [1, 2, 3, 4, 5, 6],
      address: { city: 'Bengaluru' },
      billing: { defaultTaxRateBps: 0 },
    });
    expect((await Department.find().lean()).map((d) => d.code).sort()).toEqual([
      'DER',
      'ENT',
      'GEN',
      'ORT',
      'PED',
    ]);
    expect(await Service.countDocuments({ type: 'procedure' })).toBe(4);
    expect(await User.countDocuments({ role: 'receptionist' })).toBe(2);
    expect(await User.countDocuments({ role: 'labtech' })).toBe(2);

    // Doctors: profiles in the right departments, 7-day schedules with Sunday off.
    const gen = await Department.findOne({ code: 'GEN' }).lean();
    const mehta = await User.findOne({ email: 'dr.mehta@medassist.dev' }).lean();
    expect(await DoctorProfile.findOne({ user: mehta!._id }).lean()).toMatchObject({
      department: gen!._id,
      specialization: 'General Physician',
    });
    const iyer = await User.findOne({ email: 'dr.iyer@medassist.dev' }).lean();
    const ped = await Department.findOne({ code: 'PED' }).lean();
    expect((await DoctorProfile.findOne({ user: iyer!._id }).lean())?.department).toEqual(ped!._id);
    expect(await DoctorProfile.countDocuments()).toBe(8);
    expect(await DoctorSchedule.countDocuments()).toBe(56);
    expect(
      await DoctorSchedule.countDocuments({ weekday: 0, 'sessions.0': { $exists: true } }),
    ).toBe(0);
    expect(
      await DoctorSchedule.countDocuments({ weekday: 6, 'sessions.0': { $exists: true } }),
    ).toBeGreaterThan(0);

    const leaves = await DoctorLeave.find().lean();
    expect(leaves.map((l) => l.type).sort()).toEqual(['conference', 'leave']);
    const conference = leaves.find((l) => l.type === 'conference')!;
    expect((conference.endAt.getTime() - conference.startAt.getTime()) / 86_400_000).toBe(3);

    expect(await LabTest.countDocuments()).toBe(15);
    expect((await LabTest.findOne({ code: 'DENGUE-NS1' }).lean())?.parameters[0]).toMatchObject({
      valueType: 'option',
      options: ['Negative', 'Positive'],
    });

    // No welcome emails: the seed sets demo passwords instead.
    await new Promise((r) => setTimeout(r, 50));
    expect(emails.sent).toHaveLength(0);
    emails.restore();
  });

  it('seeds 60 patients with MRNs, allergies, conditions, portal logins and a pending sign-up', async () => {
    await runSeed();
    expect(await Patient.countDocuments()).toBe(60);
    const mrns = (await Patient.find().lean()).map((p) => p.mrn).sort();
    expect(mrns[0]).toBe('MRN-000001');
    expect(mrns[59]).toBe('MRN-000060');
    expect(await Patient.countDocuments({ 'allergies.0': { $exists: true } })).toBe(15);
    expect(await Patient.countDocuments({ 'chronicConditions.0': { $exists: true } })).toBe(12);
    expect(
      await Patient.countDocuments({ 'insurance.provider': { $exists: true } }),
    ).toBeGreaterThan(5);
    expect(await Patient.countDocuments({ phone: { $not: /^\+91\d{10}$/ } })).toBe(0);
    expect(new Set((await Patient.find().lean()).map((p) => p.gender)).size).toBeGreaterThanOrEqual(
      3,
    );
    expect(await Patient.countDocuments({ nameKey: 'amit patel' })).toBe(2);
    expect(await Patient.countDocuments({ user: { $type: 'objectId' } })).toBe(8);

    const priya = await User.findOne({ email: 'patient1@medassist.dev' }).lean();
    expect(priya).toMatchObject({ patientLinkStatus: 'linked', firstName: 'Priya' });
    expect((await Patient.findById(priya!.patient).lean())?.user).toEqual(priya!._id);

    const pending = await User.findOne({ email: PENDING_SIGNUP_EMAIL }).lean();
    expect(pending?.patientLinkStatus).toBe('pending_verification');
    const target = await Patient.findById(pending!.patient).lean();
    expect(target?.user).toBeUndefined();
    expect(target?.phone).toBe(pending?.phone);

    // Patient ages span children to the elderly.
    const years = patientSeeds().map((s) => Number(s.body.dateOfBirth.slice(0, 4)));
    expect(Math.max(...years) - Math.min(...years)).toBeGreaterThan(80);
  });

  it('patient logins see their own record; the pending one is blocked', async () => {
    await runSeed();
    const login = (email: string) =>
      api().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
    const priya = await login('patient1@medassist.dev');
    const me = await api()
      .get('/api/v1/patients/me')
      .set({ Authorization: `Bearer ${priya.body.data.accessToken}` });
    expect(me.body.data).toMatchObject({ fullName: 'Priya Sharma' });
    const pending = await login(PENDING_SIGNUP_EMAIL);
    const blocked = await api()
      .get('/api/v1/patients/me')
      .set({ Authorization: `Bearer ${pending.body.data.accessToken}` });
    expect(blocked.status).toBe(403);
  });

  it('every demo login works with the demo password, without a forced change', async () => {
    await runSeed();
    const logins = demoLogins();
    expect(logins).toHaveLength(DEMO_ACCOUNTS.length + 8 + 9);
    for (const { email } of logins) {
      const res = await api().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
      expect(res.status, email).toBe(200);
      expect(res.body.data.user.mustChangePassword, email).toBe(false);
    }
  });

  it('is idempotent: a second run creates and changes nothing', async () => {
    await runSeed();
    const countsBefore = await Promise.all(
      [User, Department, Service, DoctorProfile, DoctorSchedule, DoctorLeave, LabTest, Patient].map(
        (m) => (m as typeof User).countDocuments(),
      ),
    );
    const auditBefore = await AuditLog.countDocuments({ 'request.method': 'SEED' });

    const summary = await runSeed();
    expect(summary).toEqual({
      users: { created: 0, updated: DEMO_ACCOUNTS.length },
      settings: { created: 0, updated: 0, unchanged: 1 },
      departments: { created: 0, updated: 0, unchanged: 5 },
      services: { created: 0, updated: 0, unchanged: 12 },
      doctors: { created: 0, updated: 0, unchanged: 8, schedules: 0, leaves: 0 },
      labTests: { created: 0, updated: 0, unchanged: 15 },
      patients: { created: 0, updated: 0, unchanged: 60, portalUsers: 8, pending: 1 },
    });
    const countsAfter = await Promise.all(
      [User, Department, Service, DoctorProfile, DoctorSchedule, DoctorLeave, LabTest, Patient].map(
        (m) => (m as typeof User).countDocuments(),
      ),
    );
    expect(countsAfter).toEqual(countsBefore);
    // Services only audit real changes, so nothing new was audited.
    expect(await AuditLog.countDocuments({ 'request.method': 'SEED' })).toBe(auditBefore);
  });

  it('repairs demo data: accounts, deactivated records, and a Phase 1 doctor without a profile', async () => {
    // A Phase 1 database: dr.mehta exists as a User with no profile.
    await User.create({
      firstName: 'Anil',
      lastName: 'Mehta',
      email: 'dr.mehta@medassist.dev',
      passwordHash: 'x',
      role: 'doctor',
      mustChangePassword: true,
    });
    await runSeed();
    const mehta = await User.findOne({ email: 'dr.mehta@medassist.dev' }).lean();
    expect(await DoctorProfile.exists({ user: mehta!._id })).not.toBeNull();
    expect(mehta).toMatchObject({ mustChangePassword: false, isActive: true });

    await User.updateOne(
      { email: 'lab1@medassist.dev' },
      {
        $set: { isActive: false, mustChangePassword: true, lockUntil: new Date(Date.now() + 1e6) },
      },
    );
    await LabTest.updateOne({ code: 'CBC' }, { $set: { isActive: false, pricePaise: 1 } });
    const summary = await runSeed();
    expect(summary.labTests).toEqual({ created: 0, updated: 1, unchanged: 14 });
    expect(await LabTest.findOne({ code: 'CBC' }).lean()).toMatchObject({
      isActive: true,
      pricePaise: 35_000,
    });
    const lab = await User.findOne({ email: 'lab1@medassist.dev' }).lean();
    expect(lab).toMatchObject({ isActive: true, mustChangePassword: false });
    expect(lab?.lockUntil).toBeUndefined();
  });

  it('puts the pending sign-up back to pending after a demo confirm', async () => {
    await runSeed();
    const pending = await User.findOne({ email: PENDING_SIGNUP_EMAIL }).lean();
    await User.updateOne({ _id: pending!._id }, { $set: { patientLinkStatus: 'linked' } });
    await Patient.updateOne({ _id: pending!.patient }, { $set: { user: pending!._id } });
    await runSeed();
    expect(await User.findById(pending!._id).lean()).toMatchObject({
      patientLinkStatus: 'pending_verification',
    });
    expect((await Patient.findById(pending!.patient).lean())?.user).toBeUndefined();
  });

  it('audits through the services, marked as the seed', async () => {
    await runSeed();
    const users = await AuditLog.find({ 'metadata.source': 'seed' }).lean();
    expect(users).toHaveLength(DEMO_ACCOUNTS.length + patientLogins().length);
    expect(users.every((e) => e.actor?.user === null && e.action === 'user.create')).toBe(true);

    const viaServices = await AuditLog.find({ 'request.method': 'SEED' }).lean();
    const actions = new Set(viaServices.map((e) => e.action));
    for (const action of [
      'settings.update',
      'department.create',
      'service.create',
      'doctor.create',
      'doctor.schedule_update',
      'doctor.leave_create',
      'lab_test.create',
      'patient.create',
    ]) {
      expect(actions.has(action as never), action).toBe(true);
    }
    expect(viaServices.every((e) => e.request?.path === 'npm run seed')).toBe(true);
  });

  it('doctor data is the same on every run (fixed faker seed)', () => {
    expect(doctorSeeds()).toEqual(doctorSeeds());
    const emails = doctorSeeds().map((d) => d.email);
    expect(new Set(emails).size).toBe(8);
    expect(emails.slice(0, 2)).toEqual(['dr.mehta@medassist.dev', 'dr.iyer@medassist.dev']);
  });

  it('only allows --reset in development', async () => {
    await expect(runSeed({ reset: true })).rejects.toThrow(
      /only allowed with NODE_ENV=development/,
    );
  });

  it('prints a table of the demo logins and a summary', () => {
    const table = demoLoginTable();
    expect(table.split('\n')[0]).toMatch(/^Role\s+Email\s+Password$/);
    for (const a of demoLogins()) expect(table).toContain(a.email);
    expect(summaryTable({ departments: { created: 5, updated: 0 } })).toMatch(
      /departments\s+5 created, 0 updated/,
    );
  });
});
