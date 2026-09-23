import { AUTH_LIMITS } from '../src/config/constants.js';
import { Session } from '../src/modules/sessions/model.js';
import { User } from '../src/modules/users/model.js';
import { hashToken, verifyAccessToken } from '../src/utils/tokens.js';
import { auditEntries, loginAs, refreshCookieFrom, refreshWith, resetDb } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** Moves a session's rotation time into the past (simulates waiting). */
async function ageRotation(refreshToken: string, seconds: number) {
  await Session.updateOne(
    { refreshTokenHash: hashToken(refreshToken) },
    { $set: { revokedAt: new Date(Date.now() - seconds * 1000) } },
  );
}

describe('POST /auth/refresh', () => {
  beforeEach(resetDb);

  it('rotates the refresh token and returns a new access token', async () => {
    const { refreshToken, user } = await loginAs('patient');
    const res = await refreshWith(refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ accessToken: expect.any(String), expiresIn: 900 });
    expect(res.body.data.user.id).toBe(user._id.toString());
    const next = refreshCookieFrom(res);
    expect(next).toBeDefined();
    expect(next).not.toBe(refreshToken);

    const old = await Session.findOne({ refreshTokenHash: hashToken(refreshToken) }).lean();
    const replacement = await Session.findOne({ refreshTokenHash: hashToken(next ?? '') }).lean();
    expect(old).toMatchObject({ revokedReason: 'rotated' });
    expect(old?.replacedBy?.toString()).toBe(replacement?._id.toString());
    expect(replacement?.family).toBe(old?.family);
    expect(replacement?.revokedAt).toBeNull();
    expect(verifyAccessToken(res.body.data.accessToken).sid).toBe(replacement?._id.toString());
  });

  it('requires the X-Requested-With CSRF header', async () => {
    const { refreshToken } = await loginAs('patient');
    const res = await api().post('/api/v1/auth/refresh').set('Cookie', `ma_rt=${refreshToken}`);
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'FORBIDDEN');
  });

  it('returns 401 SESSION_REVOKED (and clears the cookie) without a cookie or for an unknown token', async () => {
    const none = await api().post('/api/v1/auth/refresh').set('X-Requested-With', 'medassist');
    expect(none.status).toBe(401);
    expectErrorShape(none.body, 'SESSION_REVOKED');
    expect(none.headers['set-cookie']?.[0]).toMatch(/^ma_rt=;/);

    const unknown = await refreshWith('not-a-real-token');
    expect(unknown.status).toBe(401);
    expectErrorShape(unknown.body, 'SESSION_REVOKED');
    expect(unknown.headers['set-cookie']?.[0]).toMatch(/^ma_rt=;/); // cookie cleared
  });

  it('within the grace window, returns an access token for the replacement without a new cookie', async () => {
    const { refreshToken } = await loginAs('doctor');
    const first = await refreshWith(refreshToken);
    const replacementSid = verifyAccessToken(first.body.data.accessToken).sid;

    const second = await refreshWith(refreshToken);
    expect(second.status).toBe(200);
    expect(refreshCookieFrom(second)).toBeUndefined();
    expect(verifyAccessToken(second.body.data.accessToken).sid).toBe(replacementSid);
    expect(await auditEntries('auth.refresh_reuse')).toHaveLength(0);
  });

  it('handles two tabs refreshing at the same moment: one rotation, both succeed', async () => {
    const { refreshToken } = await loginAs('doctor');
    const results = await Promise.all([refreshWith(refreshToken), refreshWith(refreshToken)]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const sids = results.map((r) => verifyAccessToken(r.body.data.accessToken).sid);
    expect(sids[0]).toBe(sids[1]);
    expect(results.filter((r) => refreshCookieFrom(r)).length).toBe(1);
    // login session + exactly one replacement
    expect(await Session.countDocuments()).toBe(2);
  });

  it('after the grace window, reuse revokes the whole family and is audited', async () => {
    const { refreshToken, user } = await loginAs('receptionist');
    const first = await refreshWith(refreshToken);
    const current = refreshCookieFrom(first) ?? '';
    const other = await loginAs('receptionist'); // unrelated user's session stays alive
    await ageRotation(refreshToken, AUTH_LIMITS.refreshGraceSeconds + 1);

    const reuse = await refreshWith(refreshToken);
    expect(reuse.status).toBe(401);
    expectErrorShape(reuse.body, 'SESSION_REVOKED');

    const family = await Session.find({ user: user._id }).lean();
    expect(family.every((s) => s.revokedAt)).toBe(true);
    expect(family.map((s) => s.revokedReason).sort()).toEqual(['reuse_detected', 'rotated']);

    // The legitimate holder's current token is dead too.
    expect((await refreshWith(current)).status).toBe(401);
    expect((await refreshWith(other.refreshToken)).status).toBe(200);

    const [entry] = await auditEntries('auth.refresh_reuse');
    expect(entry).toMatchObject({
      outcome: 'denied',
      actor: { user: user._id },
      resource: { type: 'session_family' },
    });
  });

  it('keeps access tokens of a rotated session working until the login ends', async () => {
    const { auth, refreshToken } = await loginAs('doctor');
    const refreshed = await refreshWith(refreshToken); // e.g. another tab refreshed
    expect((await api().get('/api/v1/auth/me').set(auth)).status).toBe(200);

    // Logging out with either token ends the whole login, so the old token dies too.
    const fresh = { Authorization: `Bearer ${refreshed.body.data.accessToken}` };
    expect((await api().post('/api/v1/auth/logout').set(auth)).status).toBe(200);
    expectErrorShape((await api().get('/api/v1/auth/me').set(auth)).body, 'SESSION_REVOKED');
    expectErrorShape((await api().get('/api/v1/auth/me').set(fresh)).body, 'SESSION_REVOKED');
    expect((await refreshWith(refreshCookieFrom(refreshed) ?? '')).status).toBe(401);
  });

  it('rejects a token from a logged-out session without treating it as theft', async () => {
    const { refreshToken, auth } = await loginAs('patient');
    await api().post('/api/v1/auth/logout').set(auth);
    const res = await refreshWith(refreshToken);
    expectErrorShape(res.body, 'SESSION_REVOKED');
    expect(await auditEntries('auth.refresh_reuse')).toHaveLength(0);
  });

  it('rejects expired sessions and deactivated users', async () => {
    const a = await loginAs('patient');
    await Session.updateOne(
      { refreshTokenHash: hashToken(a.refreshToken) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expectErrorShape((await refreshWith(a.refreshToken)).body, 'SESSION_REVOKED');

    const b = await loginAs('labtech');
    await User.updateOne({ _id: b.user._id }, { $set: { isActive: false } });
    const res = await refreshWith(b.refreshToken);
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'ACCOUNT_INACTIVE');
  });

  it('slides the expiry forward on each rotation', async () => {
    const { refreshToken } = await loginAs('patient');
    await Session.updateOne(
      { refreshTokenHash: hashToken(refreshToken) },
      { $set: { expiresAt: new Date(Date.now() + 60_000) } },
    );
    const res = await refreshWith(refreshToken);
    const next = await Session.findOne({
      refreshTokenHash: hashToken(refreshCookieFrom(res) ?? ''),
    }).lean();
    expect(next?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
  });
});
