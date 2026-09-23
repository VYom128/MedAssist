import { AUDIT_ACTIONS } from '../src/config/constants.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Session } from '../src/modules/sessions/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { hashToken, verifyAccessToken } from '../src/utils/tokens.js';
import {
  createUser,
  loginAs,
  refreshCookieFrom,
  refreshWith,
  resetDb,
  TEST_PASSWORD,
} from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api } from './helpers/testApp.js';

/**
 * Every action in AUDIT_ACTIONS is written by the real endpoints (spec §10.4), and no audit
 * entry ever contains a password, token, hash or cookie. When a phase adds an action, add the
 * step that triggers it here.
 */
describe('audit coverage', () => {
  it('writes every Phase 1 action, with no secrets in any entry', async () => {
    await resetDb();
    const emails = captureEmails();
    const secrets: string[] = [TEST_PASSWORD];
    const keep = (...values: (string | undefined)[]) =>
      secrets.push(...values.filter((v): v is string => Boolean(v)));

    // auth.register
    const reg = await api().post('/api/v1/auth/register').send({
      firstName: 'Neha',
      lastName: 'Gupta',
      email: 'neha@example.com',
      phone: '+919812345678',
      dateOfBirth: '1992-03-04',
      password: 'Audit-2026-pass',
      acceptTerms: true,
    });
    keep('Audit-2026-pass', reg.body.data.accessToken, refreshCookieFrom(reg));

    // auth.login, auth.login_failed
    const admin = await loginAs('admin');
    keep(admin.token, admin.refreshToken);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: admin.user.email, password: 'Wrong-pass-1' });

    // auth.profile_update
    await api().patch('/api/v1/auth/me').set(admin.auth).send({ phone: '+919800000009' });

    // user.create, user.update, user.deactivate, user.activate, user.unlock, user.reset_password
    const created = await api().post('/api/v1/users').set(admin.auth).send({
      firstName: 'Ravi',
      lastName: 'Kumar',
      email: 'ravi@clinic.dev',
      role: 'receptionist',
    });
    const id = created.body.data.id as string;
    await api().patch(`/api/v1/users/${id}`).set(admin.auth).send({ lastName: 'Rao' });
    await api().post(`/api/v1/users/${id}/deactivate`).set(admin.auth);
    await api().post(`/api/v1/users/${id}/activate`).set(admin.auth);
    await api().post(`/api/v1/users/${id}/unlock`).set(admin.auth);
    await api().post(`/api/v1/users/${id}/reset-password`).set(admin.auth);

    // access.denied, audit.verify
    const doctor = await loginAs('doctor');
    keep(doctor.token, doctor.refreshToken);
    await api().get('/api/v1/users').set(doctor.auth);
    await api().get('/api/v1/audit-logs/verify').set(admin.auth);

    // auth.session_revoke (a second login of the doctor), auth.logout_all
    const second = await api()
      .post('/api/v1/auth/login')
      .send({ email: doctor.user.email, password: TEST_PASSWORD });
    keep(second.body.data.accessToken, refreshCookieFrom(second));
    await api()
      .delete(`/api/v1/auth/sessions/${verifyAccessToken(second.body.data.accessToken).sid}`)
      .set(doctor.auth);
    await api().post('/api/v1/auth/logout-all').set(doctor.auth);

    // auth.refresh_reuse: reuse a rotated token after the grace window
    const lab = await loginAs('labtech');
    keep(lab.token, lab.refreshToken);
    const rotated = await refreshWith(lab.refreshToken);
    keep(rotated.body.data.accessToken, refreshCookieFrom(rotated));
    await Session.updateOne(
      { refreshTokenHash: hashToken(lab.refreshToken) },
      { $set: { revokedAt: new Date(Date.now() - 60_000) } },
    );
    await refreshWith(lab.refreshToken);

    // auth.password_changed, auth.password_reset_requested, auth.password_reset, auth.logout
    const staff = await createUser('receptionist', { firstName: 'Kiran' });
    const staffLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: TEST_PASSWORD });
    const staffAuth = { Authorization: `Bearer ${staffLogin.body.data.accessToken}` };
    const changed = await api()
      .post('/api/v1/auth/change-password')
      .set(staffAuth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Changed-2026-pw' });
    keep('Changed-2026-pw', staffLogin.body.data.accessToken, changed.body.data.accessToken);
    await api().post('/api/v1/auth/forgot-password').send({ email: staff.email });
    await emails.lastToken();
    const token = emails.sent.at(-1)?.links?.[0]?.split('/').at(-1);
    keep(token);
    await api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset-2026-pw' });
    keep('Reset-2026-pw');
    const again = await api()
      .post('/api/v1/auth/login')
      .send({ email: staff.email, password: 'Reset-2026-pw' });
    await api()
      .post('/api/v1/auth/logout')
      .set({ Authorization: `Bearer ${again.body.data.accessToken}` });
    emails.restore();

    await flushAudit();
    const entries = await AuditLog.find().lean();
    const written = new Set(entries.map((e) => e.action));
    const missing = Object.values(AUDIT_ACTIONS).filter((a) => !written.has(a));
    expect(missing).toEqual([]);

    const stored = JSON.stringify(entries);
    for (const secret of secrets) expect(stored).not.toContain(secret);
    for (const secret of secrets) expect(stored).not.toContain(hashToken(secret));
    expect(stored).not.toMatch(/passwordHash"|refreshTokenHash|ma_rt=|\$2[aby]\$/);
  });
});
