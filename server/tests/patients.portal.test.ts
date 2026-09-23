import { Patient } from '../src/modules/patients/model.js';
import { User } from '../src/modules/users/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { createPatient, loginAsPatient } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const GENERIC = "We couldn't create your account. Please contact the clinic.";

const signup = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@example.com',
  phone: '98765 43210',
  dateOfBirth: '1990-05-17',
  password: 'Clinic2026!pass',
  acceptTerms: true,
  consent: { dataProcessing: true },
  ...overrides,
});

const register = (body: Record<string, unknown>) => api().post('/api/v1/auth/register').send(body);
const bearer = (res: { body: { data: { accessToken: string } } }) => ({
  Authorization: `Bearer ${res.body.data.accessToken}`,
});

describe('self-signup linking (spec §4.4)', () => {
  beforeEach(resetDb);

  it('no matching patient → a new patient record, linked; /patients/me works', async () => {
    const res = await register(signup());
    expect(res.status).toBe(201);
    expect(res.body.data.link.status).toBe('linked');
    const patient = await Patient.findOne().lean();
    expect(patient).toMatchObject({
      mrn: 'MRN-000001',
      firstName: 'Priya',
      phone: '+919876543210',
      gender: 'unknown',
      email: 'priya@example.com',
      consent: { dataProcessing: { given: true }, aiExplanations: { given: true } },
    });
    expect(patient?.user?.toString()).toBe(res.body.data.user.id);

    const me = await api().get('/api/v1/patients/me').set(bearer(res));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ mrn: 'MRN-000001', fullName: 'Priya Sharma' });
    const [created] = await auditEntries('patient.create');
    expect(created?.metadata).toEqual({ source: 'self_signup' });
  });

  it('a match without a portal account → pending; the user sees no records', async () => {
    const existing = await createPatient({
      firstName: 'Priya',
      lastName: 'Sharma',
      phone: '+919876543210',
      dateOfBirth: '1990-05-17',
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
    });
    const res = await register(signup({ phone: '+91 98765 43210' }));
    expect(res.status).toBe(201);
    expect(res.body.data.link).toEqual({
      status: 'pending_verification',
      message: expect.stringMatching(/confirm your identity/),
    });
    expect(res.body.data.user).toMatchObject({
      patientId: null,
      patientLinkStatus: 'pending_verification',
    });
    expect(await Patient.countDocuments()).toBe(1);
    const user = await User.findById(res.body.data.user.id).lean();
    expect(user?.patient?.toString()).toBe(existing.id);
    expect((await Patient.findById(existing.id).lean())?.user).toBeUndefined();

    // Blocked from /me (403 PATIENT_LINK_PENDING) and from the record itself (404).
    const me = await api().get('/api/v1/patients/me').set(bearer(res));
    expect(me.status).toBe(403);
    expectErrorShape(me.body, 'PATIENT_LINK_PENDING');
    const patch = await api()
      .patch('/api/v1/patients/me')
      .set(bearer(res))
      .send({ preferredLanguage: 'hi' });
    expectErrorShape(patch.body, 'PATIENT_LINK_PENDING');
    const direct = await api().get(`/api/v1/patients/${existing.id}`).set(bearer(res));
    expect(direct.status).toBe(404);
    expect(JSON.stringify([me.body, direct.body])).not.toContain('Penicillin');
    const authMe = await api().get('/api/v1/auth/me').set(bearer(res));
    expect(authMe.body.data).toMatchObject({
      patientId: null,
      patientLinkStatus: 'pending_verification',
    });
  });

  it('a match that already has a portal account → generic rejection, nothing created', async () => {
    const owner = await loginAsPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
    const res = await register(signup());
    expect(res.status).toBe(422);
    expect(expectErrorShape(res.body, 'BUSINESS_RULE_VIOLATION').message).toBe(GENERIC);
    expect(await User.countDocuments({ email: 'priya@example.com' })).toBe(0);
    expect(await Patient.countDocuments()).toBe(1);
    const [failed] = await auditEntries('auth.register');
    expect(failed).toMatchObject({
      outcome: 'failure',
      metadata: { reason: 'matched_patient_has_account' },
    });
    expect(failed?.patient?.toString()).toBe(owner.patientId);
  });

  it('a pending account also counts as a portal account', async () => {
    await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
    expect((await register(signup())).status).toBe(201); // pending
    const second = await register(signup({ email: 'someone.else@example.com' }));
    expect(second.status).toBe(422);
    expect(second.body.message).toBe(GENERIC);
  });

  it('with two matches (twins), the one without an account is used', async () => {
    const first = await loginAsPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
    const twin = await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
    const res = await register(signup());
    expect(res.body.data.link.status).toBe('pending_verification');
    const user = await User.findById(res.body.data.user.id).lean();
    expect(user?.patient?.toString()).toBe(twin.id);
    expect(user?.patient?.toString()).not.toBe(first.patientId);
  });

  it('parallel sign-ups for the same unlinked record: one pending, the rest rejected', async () => {
    await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
    const results = await Promise.all(
      [1, 2, 3].map((i) => register(signup({ email: `p${i}@example.com` }))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 422, 422]);
    expect(await User.countDocuments({ patientLinkStatus: 'pending_verification' })).toBe(1);
  });
});

describe('PATCH /patients/me', () => {
  beforeEach(resetDb);

  it('updates contact details, language and consents; audited via the portal', async () => {
    const me = await loginAsPatient({
      consent: {
        dataProcessing: { given: true, at: new Date() },
        aiExplanations: { given: true, at: new Date() },
      },
    });
    const res = await api()
      .patch('/api/v1/patients/me')
      .set(me.auth)
      .send({
        phone: '09876 500001',
        email: 'Me@Example.com',
        address: { line1: '5 Lake Road', city: 'Pune' },
        emergencyContact: { name: 'Asha', relation: 'Mother', phone: '9876500002' },
        preferredLanguage: 'hi',
        consent: { aiExplanations: false, communications: { sms: true } },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      phone: '+919876500001',
      email: 'me@example.com',
      preferredLanguage: 'hi',
      consent: {
        aiExplanations: { given: false },
        communications: { email: true, sms: true },
      },
    });
    expect(res.body.data).not.toHaveProperty('adminNotes');
    const [entry] = await auditEntries('patient.update');
    expect(entry?.metadata).toEqual({ via: 'portal' });
    expect(entry?.changes?.after).toMatchObject({
      consentAiExplanations: false,
      consentCommunications: { email: true, sms: true },
      phone: '[REDACTED]',
    });
  });

  it.each([
    ['firstName', { firstName: 'New' }],
    ['dateOfBirth', { dateOfBirth: '1990-01-01' }],
    ['gender', { gender: 'male' }],
    ['allergies', { allergies: [] }],
    ['adminNotes', { adminNotes: 'x' }],
    ['consent.dataProcessing', { consent: { dataProcessing: false } }],
  ])('cannot change %s', async (_field, body) => {
    const me = await loginAsPatient();
    const res = await api().patch('/api/v1/patients/me').set(me.auth).send(body);
    expectErrorShape(res.body, 'VALIDATION_ERROR');
  });

  it('staff cannot use /patients/me (403)', async () => {
    for (const role of ['admin', 'receptionist', 'doctor', 'labtech'] as const) {
      const res = await api()
        .get('/api/v1/patients/me')
        .set((await loginAs(role)).auth);
      expect(res.status, role).toBe(403);
    }
  });

  it('a patient user with no record at all gets 404', async () => {
    const orphan = await loginAs('patient');
    const res = await api().get('/api/v1/patients/me').set(orphan.auth);
    expect(res.status).toBe(404);
  });
});

describe('reception: pending links, confirm and reject', () => {
  let reception: LoggedIn;
  let existingId: string;
  let userId: string;
  let pendingAuth: { Authorization: string };

  beforeEach(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
    existingId = (
      await createPatient({
        firstName: 'Priya',
        lastName: 'Sharma',
        phone: '+919876543210',
        dateOfBirth: '1990-05-17',
      })
    ).id;
    const res = await register(signup());
    userId = res.body.data.user.id;
    pendingAuth = bearer(res);
  });

  it('GET /patients/pending-links lists the sign-up next to the candidate record', async () => {
    const res = await api().get('/api/v1/patients/pending-links').set(reception.auth);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({
      userId,
      signup: {
        firstName: 'Priya',
        email: 'priya@example.com',
        phone: '+919876543210',
        dateOfBirth: '1990-05-17',
      },
      patient: { id: existingId, mrn: 'MRN-000001', dateOfBirth: '1990-05-17' },
    });
  });

  it('confirm → linked, record visible, email sent, audited', async () => {
    const emails = captureEmails();
    const res = await api()
      .post(`/api/v1/patients/${existingId}/confirm-link`)
      .set(reception.auth)
      .send({ userId });
    expect(res.status).toBe(200);
    expect(res.body.data.portal).toMatchObject({ hasAccount: true, linkStatus: 'linked' });
    expect((await Patient.findById(existingId).lean())?.user?.toString()).toBe(userId);

    const me = await api().get('/api/v1/patients/me').set(pendingAuth);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(existingId);

    await vi.waitFor(() => expect(emails.sent).toHaveLength(1));
    expect(emails.sent[0]).toMatchObject({
      to: 'priya@example.com',
      subject: 'Your MedAssist records are now available',
    });
    expect(emails.sent[0]!.text).not.toMatch(/MRN|1990/);
    emails.restore();
    const [entry] = await auditEntries('patient.link_confirm');
    expect(entry?.metadata).toEqual({ userId });

    // Nothing left to confirm.
    const again = await api()
      .post(`/api/v1/patients/${existingId}/confirm-link`)
      .set(reception.auth)
      .send({ userId });
    expect(again.status).toBe(404);
  });

  it('reject → a new separate record (new MRN) linked to the user; original untouched', async () => {
    const res = await api()
      .post(`/api/v1/patients/${existingId}/reject-link`)
      .set(reception.auth)
      .send({ userId, reason: 'Twin sister – different person' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      mrn: 'MRN-000002',
      fullName: 'Priya Sharma',
      phone: '+919876543210',
      dateOfBirth: '1990-05-17',
      portal: { hasAccount: true, linkStatus: 'linked' },
    });
    expect((await Patient.findById(existingId).lean())?.user).toBeUndefined();

    const me = await api().get('/api/v1/patients/me').set(pendingAuth);
    expect(me.body.data.id).toBe(res.body.data.id);
    const [entry] = await auditEntries('patient.link_reject');
    expect(entry?.metadata).toMatchObject({
      reason: 'Twin sister – different person',
      userId,
      newMrn: 'MRN-000002',
    });
    expect(entry?.patient?.toString()).toBe(existingId);
  });

  it('reject needs a reason; confirm/reject need the right user and are reception only', async () => {
    const noReason = await api()
      .post(`/api/v1/patients/${existingId}/reject-link`)
      .set(reception.auth)
      .send({ userId });
    expectErrorShape(noReason.body, 'VALIDATION_ERROR');

    const other = await createPatient();
    const wrong = await api()
      .post(`/api/v1/patients/${other.id}/confirm-link`)
      .set(reception.auth)
      .send({ userId });
    expect(wrong.status).toBe(404);

    const admin = await loginAs('admin');
    const byAdmin = await api()
      .post(`/api/v1/patients/${existingId}/confirm-link`)
      .set(admin.auth)
      .send({ userId });
    expect(byAdmin.status).toBe(403);
  });
});

describe('POST /patients/:id/portal-invite', () => {
  let reception: LoggedIn;
  beforeEach(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
  });
  const invite = (id: string, me: LoggedIn = reception) =>
    api().post(`/api/v1/patients/${id}/portal-invite`).set(me.auth);

  it('creates a linked patient user, emails a set-password link that works', async () => {
    const emails = captureEmails();
    const { id } = await createPatient({ firstName: 'Kiran', email: 'kiran@example.com' });
    const res = await invite(id);
    expect(res.status).toBe(201);
    expect(res.body.data.portal).toMatchObject({
      hasAccount: true,
      email: 'kiran@example.com',
      linkStatus: 'linked',
      lastLoginAt: null,
    });
    const user = await User.findOne({ email: 'kiran@example.com' }).lean();
    expect(user).toMatchObject({
      role: 'patient',
      patientLinkStatus: 'linked',
      mustChangePassword: false,
    });
    expect(user?.patient?.toString()).toBe(id);

    const token = await emails.lastToken();
    expect(emails.sent[0]).toMatchObject({
      to: 'kiran@example.com',
      subject: 'Your MedAssist patient portal account',
    });
    emails.restore();
    const set = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'Portal-2026-pw' });
    expect(set.status).toBe(200);
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'kiran@example.com', password: 'Portal-2026-pw' });
    expect(login.status).toBe(200);
    const me = await api()
      .get('/api/v1/patients/me')
      .set({ Authorization: `Bearer ${login.body.data.accessToken}` });
    expect(me.body.data.id).toBe(id);
    const [entry] = await auditEntries('patient.portal_invite');
    expect(entry?.metadata).toEqual({ userId: user!._id.toString() });
  });

  it('admins can invite too', async () => {
    const emails = captureEmails();
    const { id } = await createPatient({ email: 'a@example.com' });
    expect((await invite(id, await loginAs('admin'))).status).toBe(201);
    emails.restore();
  });

  it('needs an email on the record (422) and an active record', async () => {
    const { id } = await createPatient();
    const res = await invite(id);
    expect(res.status).toBe(422);
    const inactive = await createPatient({ email: 'x@example.com', isActive: false });
    expect((await invite(inactive.id)).status).toBe(422);
  });

  it('409 when the email already has an account or the patient has one', async () => {
    const emails = captureEmails();
    const taken = await loginAs('doctor');
    const { id } = await createPatient({ email: taken.user.email });
    const res = await invite(id);
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'CONFLICT');

    const linked = await loginAsPatient({ email: 'linked@example.com' });
    expect((await invite(linked.patientId)).status).toBe(409);

    const ok = await createPatient({ email: 'once@example.com' });
    expect((await invite(ok.id)).status).toBe(201);
    expect((await invite(ok.id)).status).toBe(409);
    emails.restore();
  });

  it('doctors, lab techs and patients cannot invite (403)', async () => {
    const { id } = await createPatient({ email: 'b@example.com' });
    for (const role of ['doctor', 'labtech', 'patient'] as const) {
      expect((await invite(id, await loginAs(role))).status, role).toBe(403);
    }
  });
});
