import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../src/config/env.js';
import {
  authenticate,
  authenticateAllowingPasswordChange,
} from '../src/middlewares/authenticate.js';
import { authorize } from '../src/middlewares/authorize.js';
import { Session } from '../src/modules/sessions/model.js';
import { User } from '../src/modules/users/model.js';
import { signAccessToken, verifyAccessToken } from '../src/utils/tokens.js';
import { auditEntries, loginAs, resetDb } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const routes = Router();
routes.get('/test/me', authenticate, (req, res) => res.json({ user: req.user }));
routes.get('/test/pending-ok', authenticateAllowingPasswordChange, (_req, res) =>
  res.json({ ok: true }),
);
routes.get('/test/admin-only', authenticate, authorize('admin'), (_req, res) =>
  res.json({ ok: true }),
);
const app = () => api(routes);

describe('authenticate', () => {
  beforeEach(resetDb);

  it('sets req.user from a valid token', async () => {
    const { auth, user, token } = await loginAs('doctor');
    const res = await app().get('/test/me').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: user._id.toString(),
      role: 'doctor',
      sid: verifyAccessToken(token).sid,
      sessionFamily: expect.any(String),
      firstName: user.firstName,
      lastName: user.lastName,
      patientId: null,
    });
  });

  it.each([
    ['no header', undefined],
    ['not Bearer', 'Basic abc'],
    ['garbage token', 'Bearer abc.def.ghi'],
  ])('401 UNAUTHORIZED for %s', async (_label, header) => {
    const req = app().get('/test/me');
    const res = await (header ? req.set('Authorization', header) : req);
    expect(res.status).toBe(401);
    expectErrorShape(res.body, 'UNAUTHORIZED');
  });

  it('401 for a token signed with another secret or algorithm', async () => {
    const { user } = await loginAs('doctor');
    const payload = { role: 'doctor', sid: new Types.ObjectId().toString() };
    const forged = jwt.sign(payload, 'x'.repeat(40), { subject: user._id.toString() });
    const none = jwt.sign(payload, '', { algorithm: 'none', subject: user._id.toString() });
    for (const t of [forged, none]) {
      expectErrorShape(
        (await app().get('/test/me').set('Authorization', `Bearer ${t}`)).body,
        'UNAUTHORIZED',
      );
    }
  });

  it('401 TOKEN_EXPIRED for an expired token', async () => {
    const { user, token } = await loginAs('doctor');
    const { sid } = verifyAccessToken(token);
    const expired = jwt.sign({ role: 'doctor', sid }, config.auth.accessSecret, {
      subject: user._id.toString(),
      expiresIn: -10,
    });
    const res = await app().get('/test/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expectErrorShape(res.body, 'TOKEN_EXPIRED');
  });

  it('401 SESSION_REVOKED once the session is revoked (no 15-minute window)', async () => {
    const { auth, token } = await loginAs('receptionist');
    await Session.updateOne(
      { _id: verifyAccessToken(token).sid },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    );
    expectErrorShape((await app().get('/test/me').set(auth)).body, 'SESSION_REVOKED');
  });

  it('401 SESSION_REVOKED for tokens issued before the last password change', async () => {
    const { auth, user } = await loginAs('receptionist');
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordChangedAt: new Date(Date.now() + 2000) } },
    );
    expectErrorShape((await app().get('/test/me').set(auth)).body, 'SESSION_REVOKED');
  });

  it('401 when the session belongs to another user or the role changed', async () => {
    const a = await loginAs('doctor');
    const b = await loginAs('doctor');
    const crossed = signAccessToken({
      sub: a.user._id.toString(),
      role: 'doctor',
      sid: verifyAccessToken(b.token).sid,
    });
    expect((await app().get('/test/me').set('Authorization', `Bearer ${crossed}`)).status).toBe(
      401,
    );

    const wrongRole = signAccessToken({
      sub: a.user._id.toString(),
      role: 'admin',
      sid: verifyAccessToken(a.token).sid,
    });
    expect((await app().get('/test/me').set('Authorization', `Bearer ${wrongRole}`)).status).toBe(
      401,
    );
  });

  it('403 ACCOUNT_INACTIVE for a deactivated user', async () => {
    const { auth, user } = await loginAs('labtech');
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
    const res = await app().get('/test/me').set(auth);
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'ACCOUNT_INACTIVE');
  });

  it('403 PASSWORD_CHANGE_REQUIRED unless the route allows a pending change', async () => {
    const { auth } = await loginAs('admin', { mustChangePassword: true });
    const blocked = await app().get('/test/me').set(auth);
    expect(blocked.status).toBe(403);
    expectErrorShape(blocked.body, 'PASSWORD_CHANGE_REQUIRED');
    expect((await app().get('/test/pending-ok').set(auth)).status).toBe(200);
  });
});

describe('authorize', () => {
  beforeEach(resetDb);

  it('lets allowed roles through', async () => {
    const { auth } = await loginAs('admin');
    expect((await app().get('/test/admin-only').set(auth)).status).toBe(200);
  });

  it('403 FORBIDDEN for other roles, audited as access.denied', async () => {
    const { auth, user } = await loginAs('doctor');
    const res = await app().get('/test/admin-only').set(auth);
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'FORBIDDEN');

    const [entry] = await auditEntries('access.denied');
    expect(entry).toMatchObject({
      outcome: 'denied',
      actor: { user: user._id, role: 'doctor' },
      request: { method: 'GET', path: '/test/admin-only' },
      metadata: { reason: 'role', allowedRoles: ['admin'] },
    });
  });
});
