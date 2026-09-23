import { Types } from 'mongoose';
import { Department } from '../src/modules/departments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { User } from '../src/modules/users/model.js';
import { hashToken } from '../src/utils/tokens.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { createDepartment, createDoctor, loginAsDoctor } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

let admin: LoggedIn;
let gen: string;

const PUBLIC_FIELDS = [
  'bio',
  'consultationFeePaise',
  'department',
  'experienceYears',
  'firstName',
  'id',
  'isAcceptingAppointments',
  'languages',
  'lastName',
  'name',
  'qualifications',
  'specialization',
];

const newDoctor = (overrides: object = {}) => ({
  firstName: 'Anil',
  lastName: 'Mehta',
  email: 'anil.mehta@clinic.dev',
  phone: '+919812345670',
  department: gen,
  specialization: 'General Physician',
  qualifications: ['MBBS', 'MD (Medicine)'],
  registrationNumber: 'KMC-12345',
  experienceYears: 12,
  consultationFeePaise: 50_000,
  slotMinutes: 15,
  roomNumber: '101',
  bio: 'Adult medicine.',
  languages: ['English', 'Hindi', 'Kannada'],
  ...overrides,
});

describe('/doctors', () => {
  beforeAll(() => DoctorProfile.init()); // unique indexes exist before the first transaction
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
    gen = (await createDepartment({ name: 'General Medicine', code: 'GEN' }))._id.toString();
  });

  describe('POST /doctors', () => {
    it('creates the User and the profile together and emails a set-password link', async () => {
      const emails = captureEmails();
      const res = await api().post('/api/v1/doctors').set(admin.auth).send(newDoctor());
      expect(res.status).toBe(201);

      const user = await User.findOne({ email: 'anil.mehta@clinic.dev' })
        .select('+passwordReset')
        .lean();
      expect(user).toMatchObject({ role: 'doctor', mustChangePassword: true, isActive: true });
      expect(res.body.data).toMatchObject({
        id: user!._id.toString(), // doctors are identified by their User id
        name: 'Anil Mehta',
        email: 'anil.mehta@clinic.dev',
        department: { id: gen, code: 'GEN' },
        registrationNumber: 'KMC-12345',
        consultationFeePaise: 50_000,
        isActive: true,
      });
      expect(await DoctorProfile.countDocuments({ user: user!._id })).toBe(1);

      const token = await emails.lastToken();
      expect(emails.sent[0]).toMatchObject({ to: 'anil.mehta@clinic.dev' });
      expect(user?.passwordReset?.tokenHash).toBe(hashToken(token));
      expect(await auditEntries('doctor.create')).toHaveLength(1);
      expect((await auditEntries('user.create'))[0]).toMatchObject({
        metadata: { role: 'doctor' },
      });
      emails.restore();
    });

    it('409 for a taken email; nothing is created', async () => {
      const res = await api()
        .post('/api/v1/doctors')
        .set(admin.auth)
        .send(newDoctor({ email: admin.user.email }));
      expect(expectErrorShape(res.body, 'CONFLICT').error.details).toEqual({ fields: ['email'] });
      expect(await DoctorProfile.countDocuments()).toBe(0);
    });

    it('rolls back the User when the profile fails inside the transaction', async () => {
      const emails = captureEmails();
      await api().post('/api/v1/doctors').set(admin.auth).send(newDoctor());
      // Same registration number: the profile insert fails after the User insert.
      const res = await api()
        .post('/api/v1/doctors')
        .set(admin.auth)
        .send(newDoctor({ email: 'second@clinic.dev' }));
      expect(expectErrorShape(res.body, 'CONFLICT').error.details).toEqual({
        fields: ['registrationNumber'],
      });
      expect(await User.exists({ email: 'second@clinic.dev' })).toBeNull();
      expect(await DoctorProfile.countDocuments()).toBe(1);
      expect(await auditEntries('doctor.create')).toHaveLength(1);
      await new Promise((r) => setTimeout(r, 50));
      expect(emails.sent).toHaveLength(1); // no welcome email for the rolled-back account
      emails.restore();
    });

    it('422 for an inactive department; 400 for invalid fields', async () => {
      await Department.updateOne({ _id: gen }, { isActive: false });
      const inactive = await api().post('/api/v1/doctors').set(admin.auth).send(newDoctor());
      expectErrorShape(inactive.body, 'BUSINESS_RULE_VIOLATION');

      const bad = await api()
        .post('/api/v1/doctors')
        .set(admin.auth)
        .send(newDoctor({ slotMinutes: 3, consultationFeePaise: 499.5, specialization: '' }));
      const fields = (
        expectErrorShape(bad.body, 'VALIDATION_ERROR').error.details as { field: string }[]
      ).map((d) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'body.slotMinutes',
          'body.consultationFeePaise',
          'body.specialization',
        ]),
      );
      expect(await User.countDocuments({ role: 'doctor' })).toBe(0);
    });
  });

  describe('GET /doctors', () => {
    let ped: string;
    beforeEach(async () => {
      ped = (await createDepartment({ name: 'Paediatrics', code: 'PED' }))._id.toString();
      await createDoctor(
        { firstName: 'Anil', lastName: 'Mehta' },
        { department: gen, specialization: 'General Physician' },
      );
      await createDoctor(
        { firstName: 'Kavya', lastName: 'Iyer' },
        { department: ped, specialization: 'Paediatrician' },
      );
      await createDoctor(
        { firstName: 'Rohan', lastName: 'Das' },
        { department: ped, specialization: 'Neonatologist', isAcceptingAppointments: false },
      );
      await createDoctor(
        { firstName: 'Old', lastName: 'Doctor', isActive: false },
        { department: gen },
      );
    });

    it('is public: active doctors only, public fields, sorted by last name', async () => {
      const res = await api().get('/api/v1/doctors');
      expect(res.status).toBe(200);
      expect(res.body.data.map((d: { lastName: string }) => d.lastName)).toEqual([
        'Das',
        'Iyer',
        'Mehta',
      ]);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(PUBLIC_FIELDS);
      expect(JSON.stringify(res.body)).not.toMatch(/email|registrationNumber|phone|lockVersion/);
    });

    it('filters by department, specialization, name and accepting', async () => {
      const names = async (qs: string) =>
        (await api().get(`/api/v1/doctors?${qs}`)).body.data.map(
          (d: { lastName: string }) => d.lastName,
        );
      expect(await names(`department=${ped}`)).toEqual(['Das', 'Iyer']);
      expect(await names('specialization=paed')).toEqual(['Iyer']);
      expect(await names('q=kavya%20iy')).toEqual(['Iyer']);
      expect(await names('accepting=true')).toEqual(['Iyer', 'Mehta']);
    });

    it('admins get the admin view and can include inactive doctors', async () => {
      const res = await api().get('/api/v1/doctors?includeInactive=true').set(admin.auth);
      expect(res.body.data).toHaveLength(4);
      expect(
        res.body.data.find((d: { lastName: string }) => d.lastName === 'Doctor'),
      ).toMatchObject({
        isActive: false,
        registrationNumber: expect.any(String),
      });
      const patient = await loginAs('patient');
      const notAdmin = await api().get('/api/v1/doctors?includeInactive=true').set(patient.auth);
      expect(notAdmin.body.data).toHaveLength(3);
    });
  });

  describe('GET /doctors/:id', () => {
    it('public view for everyone, admin view for admins and the doctor themselves', async () => {
      const dr = await loginAsDoctor({ department: gen, roomNumber: '12' });
      const pub = await api().get(`/api/v1/doctors/${dr.id}`);
      expect(Object.keys(pub.body.data).sort()).toEqual(PUBLIC_FIELDS);

      const asAdmin = await api().get(`/api/v1/doctors/${dr.id}`).set(admin.auth);
      expect(asAdmin.body.data).toMatchObject({
        email: dr.user.email,
        roomNumber: '12',
        registrationNumber: expect.any(String),
        isActive: true,
      });
      const own = await api().get(`/api/v1/doctors/${dr.id}`).set(dr.auth);
      expect(own.body.data).toHaveProperty('registrationNumber');
    });

    it('404 for unknown ids, non-doctors, doctors without a profile, and inactive doctors (non-admin)', async () => {
      expect((await api().get(`/api/v1/doctors/${new Types.ObjectId()}`)).status).toBe(404);
      expect((await api().get(`/api/v1/doctors/${admin.user._id}`)).status).toBe(404);
      const noProfile = await loginAs('doctor');
      expect((await api().get(`/api/v1/doctors/${noProfile.user._id}`)).status).toBe(404);
      const old = await createDoctor({ isActive: false });
      expect((await api().get(`/api/v1/doctors/${old.id}`)).status).toBe(404);
      expect((await api().get(`/api/v1/doctors/${old.id}`).set(admin.auth)).status).toBe(200);
    });
  });

  describe('PATCH /doctors/:id', () => {
    it('admins change any profile field (audited)', async () => {
      const ped = await createDepartment({ name: 'Paediatrics', code: 'PED' });
      const dr = await createDoctor({}, { department: gen });
      const res = await api().patch(`/api/v1/doctors/${dr.id}`).set(admin.auth).send({
        department: ped._id.toString(),
        consultationFeePaise: 70_000,
        isAcceptingAppointments: false,
      });
      expect(res.body.data).toMatchObject({
        department: { code: 'PED' },
        consultationFeePaise: 70_000,
        isAcceptingAppointments: false,
      });
      const [entry] = await auditEntries('doctor.update');
      expect(entry?.changes).toMatchObject({
        fields: ['department', 'consultationFeePaise', 'isAcceptingAppointments'],
        before: { department: gen },
        after: { consultationFeePaise: 70_000 },
      });
    });

    it('a doctor changes only their own bio and languages', async () => {
      const dr = await loginAsDoctor({ department: gen });
      const ok = await api()
        .patch(`/api/v1/doctors/${dr.id}`)
        .set(dr.auth)
        .send({ bio: 'Family medicine', languages: ['English', 'Tamil'] });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        bio: 'Family medicine',
        languages: ['English', 'Tamil'],
      });

      const fee = await api()
        .patch(`/api/v1/doctors/${dr.id}`)
        .set(dr.auth)
        .send({ bio: 'x', consultationFeePaise: 1 });
      expect(expectErrorShape(fee.body, 'FORBIDDEN').error.details).toEqual({
        fields: ['consultationFeePaise'],
      });

      const other = await createDoctor({}, { department: gen });
      const res = await api().patch(`/api/v1/doctors/${other.id}`).set(dr.auth).send({ bio: 'x' });
      expectErrorShape(res.body, 'FORBIDDEN');
      const denied = await auditEntries('access.denied');
      expect(denied.at(-1)).toMatchObject({ metadata: { reason: 'not_own_doctor' } });
    });

    it('a duplicate registration number is a 409', async () => {
      const a = await createDoctor({}, { department: gen, registrationNumber: 'REG-A' });
      await createDoctor({}, { department: gen, registrationNumber: 'REG-B' });
      const res = await api()
        .patch(`/api/v1/doctors/${a.id}`)
        .set(admin.auth)
        .send({ registrationNumber: 'REG-B' });
      expectErrorShape(res.body, 'CONFLICT');
    });

    it('receptionists cannot edit doctors', async () => {
      const dr = await createDoctor({}, { department: gen });
      const reception = await loginAs('receptionist');
      const res = await api()
        .patch(`/api/v1/doctors/${dr.id}`)
        .set(reception.auth)
        .send({ bio: 'x' });
      expect(res.status).toBe(403);
    });
  });

  describe('department deactivation (step 1 check, filled in here)', () => {
    it('is blocked while active doctors remain, allowed once they are inactive', async () => {
      const dr = await createDoctor({}, { department: gen });
      const blocked = await api().post(`/api/v1/departments/${gen}/deactivate`).set(admin.auth);
      expect(expectErrorShape(blocked.body, 'CONFLICT').error.details).toEqual({
        activeDoctors: 1,
      });
      expect(blocked.body.message).toMatch(/1 active doctor/);

      await User.updateOne({ _id: dr.user._id }, { isActive: false });
      const ok = await api().post(`/api/v1/departments/${gen}/deactivate`).set(admin.auth);
      expect(ok.status).toBe(200);
    });
  });
});
