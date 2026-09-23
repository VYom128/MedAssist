import { PASSWORD_RESET } from '../src/config/constants.js';
import { Session } from '../src/modules/sessions/model.js';
import { User } from '../src/modules/users/model.js';
import { verifyPassword } from '../src/utils/password.js';
import { sha256 } from '../src/utils/tokens.js';
import {
  auditEntries,
  createUser,
  loginAs,
  refreshWith,
  resetDb,
  TEST_PASSWORD,
} from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const NEW_PASSWORD = 'Brand-new-2026';

describe('POST /auth/change-password', () => {
  beforeEach(resetDb);

  it('changes the password, revokes other sessions and returns a fresh token', async () => {
    const me = await loginAs('doctor');
    const otherDevice = await api()
      .post('/api/v1/auth/login')
      .send({ email: me.user.email, password: TEST_PASSWORD });

    const res = await api()
      .post('/api/v1/auth/change-password')
      .set(me.auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      user: { role: 'doctor' },
    });

    const user = await User.findById(me.user._id).select('+passwordHash').lean();
    expect(await verifyPassword(NEW_PASSWORD, user?.passwordHash ?? '')).toBe(true);
    expect(user?.passwordChangedAt).toBeInstanceOf(Date);

    const other = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${otherDevice.body.data.accessToken}`);
    expectErrorShape(other.body, 'SESSION_REVOKED');
    const sessions = await Session.find({ user: me.user._id }).lean();
    expect(sessions.filter((s) => !s.revokedAt)).toHaveLength(1);

    const fresh = { Authorization: `Bearer ${res.body.data.accessToken}` };
    expect((await api().get('/api/v1/auth/me').set(fresh)).status).toBe(200);
    expect((await refreshWith(me.refreshToken)).status).toBe(200); // current session kept
    expect(await auditEntries('auth.password_changed')).toHaveLength(1);
  });

  it('clears mustChangePassword so other routes work again', async () => {
    const me = await loginAs('admin', { mustChangePassword: true });
    expect((await api().get('/api/v1/auth/sessions').set(me.auth)).status).toBe(403);

    const res = await api()
      .post('/api/v1/auth/change-password')
      .set(me.auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.body.data.user.mustChangePassword).toBe(false);

    const fresh = { Authorization: `Bearer ${res.body.data.accessToken}` };
    expect((await api().get('/api/v1/auth/sessions').set(fresh)).status).toBe(200);
  });

  it('400 when the current password is wrong or the new one is weak or unchanged', async () => {
    const me = await loginAs('patient');
    const change = (body: object) =>
      api().post('/api/v1/auth/change-password').set(me.auth).send(body);

    const wrong = await change({ currentPassword: 'Nope-12345', newPassword: NEW_PASSWORD });
    expect(expectErrorShape(wrong.body, 'VALIDATION_ERROR').error.details).toEqual([
      { field: 'body.currentPassword', message: 'Current password is incorrect' },
    ]);

    const weak = await change({ currentPassword: TEST_PASSWORD, newPassword: 'passw0rd' });
    expectErrorShape(weak.body, 'VALIDATION_ERROR');

    const same = await change({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    expect(expectErrorShape(same.body, 'VALIDATION_ERROR').error.details).toEqual([
      expect.objectContaining({ field: 'body.newPassword' }),
    ]);
  });
});

describe('forgot and reset password', () => {
  beforeEach(resetDb);

  it('always answers 200 and only emails existing active users', async () => {
    const emails = captureEmails();
    const user = await createUser('patient');
    const inactive = await createUser('patient', { isActive: false });

    for (const email of [user.email, 'nobody@test.medassist.dev', inactive.email]) {
      const res = await api().post('/api/v1/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(
        'If an account exists for that email, a reset link has been sent',
      );
    }
    await vi.waitFor(() => expect(emails.sent).toHaveLength(1));
    expect(emails.sent[0]).toMatchObject({
      to: user.email,
      subject: 'Reset your MedAssist password',
    });
    expect(emails.sent[0]?.links?.[0]).toMatch(
      /^http:\/\/localhost:5173\/reset-password\/[\w-]{40,}$/,
    );

    const stored = await User.findById(user._id).select('+passwordReset').lean();
    expect(stored?.passwordReset?.tokenHash).toBe(sha256(await emails.lastToken()));
    expect(stored?.passwordReset?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + PASSWORD_RESET.ttlMs,
    );
    emails.restore();
  });

  it('resets once, clears the lock and revokes all sessions', async () => {
    const emails = captureEmails();
    const me = await loginAs('receptionist');
    await User.updateOne(
      { _id: me.user._id },
      { $set: { failedLoginAttempts: 5, lockUntil: new Date(Date.now() + 600_000) } },
    );
    await api().post('/api/v1/auth/forgot-password').send({ email: me.user.email });
    const token = await emails.lastToken();

    const res = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const user = await User.findById(me.user._id).select('+passwordHash +passwordReset').lean();
    expect(await verifyPassword(NEW_PASSWORD, user?.passwordHash ?? '')).toBe(true);
    expect(user?.passwordReset).toBeUndefined();
    expect(user?.lockUntil).toBeUndefined();
    expect(user?.failedLoginAttempts).toBe(0);
    expectErrorShape((await api().get('/api/v1/auth/me').set(me.auth)).body, 'SESSION_REVOKED');

    const again = await api()
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'Another-2026x' });
    expect(again.status).toBe(400);
    expectErrorShape(again.body, 'BAD_REQUEST');

    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: me.user.email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(await auditEntries('auth.password_reset')).toHaveLength(1);
    emails.restore();
  });

  it('rejects expired and unknown tokens', async () => {
    const emails = captureEmails();
    const user = await createUser('patient');
    await api().post('/api/v1/auth/forgot-password').send({ email: user.email });
    const token = await emails.lastToken();
    await User.updateOne(
      { _id: user._id },
      { $set: { 'passwordReset.expiresAt': new Date(Date.now() - 1000) } },
    );
    for (const t of [token, 'x'.repeat(43)]) {
      const res = await api()
        .post('/api/v1/auth/reset-password')
        .send({ token: t, password: NEW_PASSWORD });
      expectErrorShape(res.body, 'BAD_REQUEST');
    }
    emails.restore();
  });
});
