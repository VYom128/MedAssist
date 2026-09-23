import express from 'express';
import request from 'supertest';
import { AUTH_LIMITS, REFRESH_COOKIE } from '../src/config/constants.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { createLoginLimiter } from '../src/middlewares/rateLimiters.js';
import { requestId } from '../src/middlewares/requestId.js';
import { Session } from '../src/modules/sessions/model.js';
import { User } from '../src/modules/users/model.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { auditEntries, createUser, resetDb, TEST_PASSWORD } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const login = (email: string, password = TEST_PASSWORD) =>
  api().post('/api/v1/auth/login').send({ email, password });

describe('POST /auth/login', () => {
  beforeEach(resetDb);

  it('returns an access token, the user and an httpOnly refresh cookie', async () => {
    const user = await createUser('doctor');
    const res = await login(user.email.toUpperCase());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Logged in',
      data: {
        accessToken: expect.any(String),
        expiresIn: 900,
        user: {
          id: user._id.toString(),
          firstName: user.firstName,
          role: 'doctor',
          mustChangePassword: false,
        },
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken/);

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE.name}=`),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const claims = verifyAccessToken(res.body.data.accessToken);
    expect(claims).toMatchObject({ sub: user._id.toString(), role: 'doctor' });
    const session = await Session.findById(claims.sid).lean();
    expect(session?.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.user.toString()).toBe(user._id.toString());

    const [entry] = await auditEntries('auth.login');
    expect(entry).toMatchObject({ outcome: 'success', actor: { role: 'doctor' } });
    expect((await User.findById(user._id).lean())?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const user = await createUser('receptionist');
    const wrong = await login(user.email, 'Wrong-pass-123');
    const unknown = await login('nobody@test.medassist.dev');

    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expectErrorShape(res.body, 'INVALID_CREDENTIALS');
      expect(res.body.message).toBe('Invalid email or password');
    }
    const failures = await auditEntries('auth.login_failed');
    expect(failures.map((f) => f.metadata)).toEqual([
      { reason: 'bad_password' },
      { reason: 'unknown_email' },
    ]);
    expect(failures[1]?.actor?.user).toBeNull();
  });

  it('locks the account after 5 failures in 15 minutes, even for the right password', async () => {
    const user = await createUser('labtech');
    for (let i = 1; i < AUTH_LIMITS.maxFailedLogins; i++) {
      expect((await login(user.email, 'Wrong-pass-123')).status).toBe(401);
    }
    const fifth = await login(user.email, 'Wrong-pass-123');
    expect(fifth.status).toBe(423);
    expectErrorShape(fifth.body, 'ACCOUNT_LOCKED');

    const correct = await login(user.email);
    expect(correct.status).toBe(423);

    const locked = await User.findById(user._id).lean();
    expect(locked?.lockUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('starts a new count when the last failure was over 15 minutes ago', async () => {
    const user = await createUser('labtech', {
      failedLoginAttempts: 4,
      lastFailedLoginAt: new Date(Date.now() - 16 * 60_000),
    });
    expect((await login(user.email, 'Wrong-pass-123')).status).toBe(401);
    expect((await User.findById(user._id).lean())?.failedLoginAttempts).toBe(1);
  });

  it('allows login again after the lock expires and resets the counter', async () => {
    const user = await createUser('labtech', {
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 16 * 60_000),
      lockUntil: new Date(Date.now() - 60_000),
    });
    expect((await login(user.email)).status).toBe(200);
    const after = await User.findById(user._id).lean();
    expect(after?.failedLoginAttempts).toBe(0);
    expect(after?.lockUntil).toBeUndefined();
  });

  it('counts parallel failures atomically', async () => {
    const user = await createUser('patient');
    await Promise.all(
      Array.from({ length: AUTH_LIMITS.maxFailedLogins }, () =>
        login(user.email, 'Wrong-pass-123'),
      ),
    );
    const after = await User.findById(user._id).lean();
    expect(after?.failedLoginAttempts).toBe(AUTH_LIMITS.maxFailedLogins);
    expect(after?.lockUntil).toBeInstanceOf(Date);
  });

  it('returns ACCOUNT_INACTIVE only after the right password', async () => {
    const user = await createUser('receptionist', { isActive: false });
    const wrong = await login(user.email, 'Wrong-pass-123');
    expectErrorShape(wrong.body, 'INVALID_CREDENTIALS');

    const right = await login(user.email);
    expect(right.status).toBe(403);
    expectErrorShape(right.body, 'ACCOUNT_INACTIVE');
    expect(await Session.countDocuments()).toBe(0);
  });

  it('logs in a user who must change their password and says so', async () => {
    const user = await createUser('admin', { mustChangePassword: true });
    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it('validates the body', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'body.email' }),
        expect.objectContaining({ field: 'body.password' }),
      ]),
    );
  });
});

describe('login rate limiter', () => {
  it('allows 10 attempts per IP + email per 15 minutes', async () => {
    const app = express();
    app.use(requestId, express.json(), createLoginLimiter());
    app.post('/login', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/login').send({ email: 'a@x.dev' })).status).toBe(200);
    }
    const blocked = await request(app).post('/login').send({ email: 'A@x.dev' });
    expect(blocked.status).toBe(429);
    expectErrorShape(blocked.body, 'RATE_LIMITED');

    // A different email from the same IP has its own budget.
    expect((await request(app).post('/login').send({ email: 'b@x.dev' })).status).toBe(200);
  });
});
