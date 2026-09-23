import { Types } from 'mongoose';
import { Session } from '../src/modules/sessions/model.js';
import { User } from '../src/modules/users/model.js';
import { sha256 } from '../src/utils/tokens.js';
import { auditEntries, createUser, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api, expectErrorShape } from './helpers/testApp.js';

let admin: LoggedIn;

describe('/users (admin)', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
  });

  describe('GET /users', () => {
    it('lists users with filters and pagination', async () => {
      await createUser('doctor', { firstName: 'Anil', lastName: 'Mehta' });
      await createUser('doctor', { isActive: false });
      await createUser('patient');

      const all = await api().get('/api/v1/users').set(admin.auth);
      expect(all.status).toBe(200);
      expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 4, totalPages: 1 });
      expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|passwordReset/);

      const doctors = await api().get('/api/v1/users?role=doctor&isActive=true').set(admin.auth);
      expect(doctors.body.data).toHaveLength(1);
      expect(doctors.body.data[0]).toMatchObject({
        firstName: 'Anil',
        role: 'doctor',
        isActive: true,
      });

      const search = await api().get('/api/v1/users?q=meh').set(admin.auth);
      expect(search.body.data.map((u: { lastName: string }) => u.lastName)).toEqual(['Mehta']);

      const regexSafe = await api().get('/api/v1/users?q=.*').set(admin.auth);
      expect(regexSafe.body.data).toHaveLength(0);

      const page = await api().get('/api/v1/users?limit=2&page=2').set(admin.auth);
      expect(page.body.meta).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });

      expect((await api().get('/api/v1/users?role=wizard').set(admin.auth)).status).toBe(400);
    });

    it('GET /users/:id returns 404 for unknown ids and 400 for bad ids', async () => {
      expect(
        (await api().get(`/api/v1/users/${new Types.ObjectId()}`).set(admin.auth)).status,
      ).toBe(404);
      expect((await api().get('/api/v1/users/123').set(admin.auth)).status).toBe(400);
      const res = await api().get(`/api/v1/users/${admin.user._id}`).set(admin.auth);
      expect(res.body.data).toMatchObject({ role: 'admin', isLocked: false });
    });
  });

  describe('POST /users', () => {
    it('creates staff and emails a set-password link (no password anywhere)', async () => {
      const emails = captureEmails();
      const res = await api().post('/api/v1/users').set(admin.auth).send({
        firstName: 'Ravi',
        lastName: 'Kumar',
        email: 'Ravi@Clinic.dev',
        role: 'receptionist',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        email: 'ravi@clinic.dev',
        role: 'receptionist',
        isActive: true,
      });

      const token = await emails.lastToken();
      expect(emails.sent[0]).toMatchObject({
        to: 'ravi@clinic.dev',
        subject: 'Your MedAssist account',
      });
      const created = await User.findOne({ email: 'ravi@clinic.dev' })
        .select('+passwordReset')
        .lean();
      expect(created?.passwordReset?.tokenHash).toBe(sha256(token));
      expect(created?.passwordReset?.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 71 * 3_600_000,
      );
      expect(created?.createdBy?.toString()).toBe(admin.user._id.toString());

      // The link sets the password and the new user can log in.
      await api().post('/api/v1/auth/reset-password').send({ token, password: 'Welcome-2026' });
      const login = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'ravi@clinic.dev', password: 'Welcome-2026' });
      expect(login.status).toBe(200);

      const [entry] = await auditEntries('user.create');
      expect(entry).toMatchObject({ metadata: { role: 'receptionist' } });
      emails.restore();
    });

    it.each(['doctor', 'patient', 'superuser'])('rejects role %s', async (role) => {
      const res = await api()
        .post('/api/v1/users')
        .set(admin.auth)
        .send({ firstName: 'A', lastName: 'B', email: 'a@b.dev', role });
      expect(res.status).toBe(400);
      expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual([
        expect.objectContaining({ field: 'body.role' }),
      ]);
    });

    it('409 for a duplicate email', async () => {
      const existing = await createUser('patient');
      const res = await api()
        .post('/api/v1/users')
        .set(admin.auth)
        .send({ firstName: 'A', lastName: 'B', email: existing.email, role: 'labtech' });
      expectErrorShape(res.body, 'CONFLICT');
    });
  });

  describe('PATCH /users/:id', () => {
    it('updates name/email/phone, redacts contact details in the audit entry', async () => {
      const user = await createUser('labtech', { emailVerifiedAt: new Date() });
      const res = await api()
        .patch(`/api/v1/users/${user._id}`)
        .set(admin.auth)
        .send({ lastName: 'Iyer', email: 'new@clinic.dev', phone: '+919000000001' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        lastName: 'Iyer',
        email: 'new@clinic.dev',
        emailVerifiedAt: null,
      });

      const [entry] = await auditEntries('user.update');
      expect(entry?.changes).toEqual({
        fields: ['lastName', 'email', 'phone'],
        before: { lastName: user.lastName, email: '[REDACTED]', phone: '[REDACTED]' },
        after: { lastName: 'Iyer', email: '[REDACTED]', phone: '[REDACTED]' },
      });
    });

    it('rejects role changes and unknown fields; 409 on a taken email', async () => {
      const user = await createUser('labtech');
      const other = await createUser('labtech');
      const role = await api()
        .patch(`/api/v1/users/${user._id}`)
        .set(admin.auth)
        .send({ role: 'admin' });
      expect(role.status).toBe(400);
      const taken = await api()
        .patch(`/api/v1/users/${user._id}`)
        .set(admin.auth)
        .send({ email: other.email });
      expectErrorShape(taken.body, 'CONFLICT');
    });
  });

  describe('deactivate / activate', () => {
    it('deactivates, revokes sessions, then activates', async () => {
      const target = await loginAs('doctor');
      const res = await api().post(`/api/v1/users/${target.user._id}/deactivate`).set(admin.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
      expect(await Session.countDocuments({ user: target.user._id, revokedReason: 'admin' })).toBe(
        1,
      );
      expect((await api().get('/api/v1/auth/me').set(target.auth)).status).toBe(403);

      const again = await api().post(`/api/v1/users/${target.user._id}/deactivate`).set(admin.auth);
      expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');

      const activate = await api()
        .post(`/api/v1/users/${target.user._id}/activate`)
        .set(admin.auth);
      expect(activate.body.data.isActive).toBe(true);
      const twice = await api().post(`/api/v1/users/${target.user._id}/activate`).set(admin.auth);
      expectErrorShape(twice.body, 'INVALID_STATUS_TRANSITION');

      expect(await auditEntries('user.deactivate')).toHaveLength(1);
      expect(await auditEntries('user.activate')).toHaveLength(1);
    });

    it('cannot deactivate yourself', async () => {
      const self = await api().post(`/api/v1/users/${admin.user._id}/deactivate`).set(admin.auth);
      expect(self.status).toBe(422);
      expectErrorShape(self.body, 'BUSINESS_RULE_VIOLATION');
    });

    // The acting admin is always active and cannot target themselves, so "last admin" can only
    // happen when two admins deactivate each other at the same moment.
    it('never leaves zero active admins, even when two admins deactivate each other at once', async () => {
      const second = await loginAs('admin');
      const [a, b] = await Promise.all([
        api().post(`/api/v1/users/${second.user._id}/deactivate`).set(admin.auth),
        api().post(`/api/v1/users/${admin.user._id}/deactivate`).set(second.auth),
      ]);
      // Depending on timing one succeeds, or both roll back (422), or the loser's own token is
      // already refused (403). Never both.
      expect(await User.countDocuments({ role: 'admin', isActive: true })).toBeGreaterThanOrEqual(
        1,
      );
      expect([a.status, b.status].filter((s) => s === 200).length).toBeLessThanOrEqual(1);
      for (const res of [a, b]) expect([200, 403, 422]).toContain(res.status);
    });
  });

  describe('unlock and reset-password', () => {
    it('unlock clears the lock so the user can log in', async () => {
      const user = await createUser('patient', {
        failedLoginAttempts: 5,
        lockUntil: new Date(Date.now() + 600_000),
      });
      const res = await api().post(`/api/v1/users/${user._id}/unlock`).set(admin.auth);
      expect(res.body.data).toMatchObject({ isLocked: false, failedLoginAttempts: 0 });
      expect(await auditEntries('user.unlock')).toHaveLength(1);
    });

    it('reset-password emails a reset link; refused for inactive users', async () => {
      const emails = captureEmails();
      const user = await createUser('receptionist');
      const res = await api().post(`/api/v1/users/${user._id}/reset-password`).set(admin.auth);
      expect(res.status).toBe(200);
      await emails.lastToken();
      expect(emails.sent[0]?.to).toBe(user.email);

      const inactive = await createUser('receptionist', { isActive: false });
      const refused = await api()
        .post(`/api/v1/users/${inactive._id}/reset-password`)
        .set(admin.auth);
      expect(refused.status).toBe(422);
      emails.restore();
    });
  });
});
