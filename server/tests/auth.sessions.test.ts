import { Types } from 'mongoose';
import { Session } from '../src/modules/sessions/model.js';
import { User } from '../src/modules/users/model.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { auditEntries, loginAs, refreshWith, resetDb, TEST_PASSWORD } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

describe('me, logout and sessions', () => {
  beforeEach(resetDb);

  it('GET /auth/me returns the caller without secrets', async () => {
    const { auth, user } = await loginAs('labtech');
    const res = await api().get('/api/v1/auth/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: user._id.toString(),
      email: user.email,
      role: 'labtech',
      patientId: null,
      doctorProfileId: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|failedLoginAttempts/);
  });

  it('PATCH /auth/me updates name and phone only, and audits field names', async () => {
    const { auth, user } = await loginAs('patient');
    const res = await api()
      .patch('/api/v1/auth/me')
      .set(auth)
      .send({ firstName: 'Meera', phone: '+919999988888' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: 'Meera', phone: '+919999988888' });

    const [entry] = await auditEntries('auth.profile_update');
    expect(entry?.changes).toEqual({
      fields: ['firstName', 'phone'],
      before: { firstName: user.firstName, phone: '[REDACTED]' },
      after: { firstName: 'Meera', phone: '[REDACTED]' },
    });

    for (const body of [{ role: 'admin' }, { email: 'x@y.dev' }, {}]) {
      const bad = await api().patch('/api/v1/auth/me').set(auth).send(body);
      expect(bad.status).toBe(400);
    }
    expect((await User.findById(user._id).lean())?.role).toBe('patient');
  });

  it('logout revokes the current session and clears the cookie', async () => {
    const { auth, token, refreshToken } = await loginAs('doctor');
    const res = await api().post('/api/v1/auth/logout').set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^ma_rt=;.*Path=\/api\/v1\/auth/);

    const session = await Session.findById(verifyAccessToken(token).sid).lean();
    expect(session?.revokedReason).toBe('logout');
    expect((await api().get('/api/v1/auth/me').set(auth)).status).toBe(401);
    expect((await refreshWith(refreshToken)).status).toBe(401);
    expect(await auditEntries('auth.logout')).toHaveLength(1);
  });

  it('logout-all revokes every session of the user only', async () => {
    const me = await loginAs('receptionist');
    await api().post('/api/v1/auth/login').send({ email: me.user.email, password: TEST_PASSWORD });
    const other = await loginAs('receptionist');

    const res = await api().post('/api/v1/auth/logout-all').set(me.auth);
    expect(res.body.data).toEqual({ sessionsRevoked: 2 });
    expect(await Session.countDocuments({ user: me.user._id, revokedAt: null })).toBe(0);
    expect((await api().get('/api/v1/auth/me').set(other.auth)).status).toBe(200);
  });

  it('lists own active sessions, marks the current one, and revokes one', async () => {
    const me = await loginAs('doctor');
    const second = await api()
      .post('/api/v1/auth/login')
      .set('User-Agent', 'Phone browser')
      .send({ email: me.user.email, password: TEST_PASSWORD });
    const secondSid = verifyAccessToken(second.body.data.accessToken).sid;
    await loginAs('doctor'); // someone else's session

    const list = await api().get('/api/v1/auth/sessions').set(me.auth);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(list.body.data.find((s: { id: string }) => s.id === secondSid)).toMatchObject({
      userAgent: 'Phone browser',
      current: false,
    });
    expect(JSON.stringify(list.body)).not.toMatch(/refreshTokenHash|family/);

    const del = await api().delete(`/api/v1/auth/sessions/${secondSid}`).set(me.auth);
    expect(del.status).toBe(200);
    expect(del.headers['set-cookie']).toBeUndefined(); // not the current session
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      ).status,
    ).toBe(401);
    expect(await auditEntries('auth.session_revoke')).toHaveLength(1);
  });

  it("404 for another user's session, 400 for a bad id", async () => {
    const me = await loginAs('patient');
    const other = await loginAs('patient');
    const otherSid = verifyAccessToken(other.token).sid;

    const res = await api().delete(`/api/v1/auth/sessions/${otherSid}`).set(me.auth);
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
    expect((await Session.findById(otherSid).lean())?.revokedAt).toBeNull();

    expect(
      (await api().delete(`/api/v1/auth/sessions/${new Types.ObjectId()}`).set(me.auth)).status,
    ).toBe(404);
    expectErrorShape(
      (await api().delete('/api/v1/auth/sessions/nope').set(me.auth)).body,
      'VALIDATION_ERROR',
    );
  });
});
