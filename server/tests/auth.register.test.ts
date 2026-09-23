import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { createRegisterLimiter } from '../src/middlewares/rateLimiters.js';
import { requestId } from '../src/middlewares/requestId.js';
import { User } from '../src/modules/users/model.js';
import { verifyPassword } from '../src/utils/password.js';
import { auditEntries, createUser, refreshCookieFrom, resetDb } from './helpers/auth.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const valid = {
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'Priya.Sharma@Example.com',
  phone: '+91 98765 43210',
  dateOfBirth: '1990-05-17',
  password: 'Clinic2026!pass',
  acceptTerms: true,
};

const register = (body: Record<string, unknown>) => api().post('/api/v1/auth/register').send(body);

describe('POST /auth/register', () => {
  beforeEach(resetDb);

  it('creates a patient user, logs them in and audits it', async () => {
    const res = await register(valid);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      user: { email: 'priya.sharma@example.com', role: 'patient', patientId: null },
    });
    expect(refreshCookieFrom(res)).toBeDefined();

    const user = await User.findOne({ email: 'priya.sharma@example.com' })
      .select('+passwordHash')
      .lean();
    expect(user).toMatchObject({
      role: 'patient',
      phone: '+919876543210',
      isActive: true,
      dateOfBirth: new Date('1990-05-17T00:00:00.000Z'),
      termsAcceptedAt: expect.any(Date),
    });
    expect(user?.patient).toBeUndefined();
    expect(user?.patientLinkStatus).toBeUndefined();
    expect(await verifyPassword(valid.password, user?.passwordHash ?? '')).toBe(true);
    expect(await auditEntries('auth.register')).toHaveLength(1);
  });

  it('ignores a role in the body (always patient)', async () => {
    const res = await register({ ...valid, role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('patient');
  });

  it('returns 409 for an email that is already registered', async () => {
    await createUser('doctor', { email: 'priya.sharma@example.com' });
    const res = await register(valid);
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'CONFLICT');
  });

  it.each([
    ['too short', 'Ab1'],
    ['no number', 'OnlyLettersHere'],
    ['no letter', '1234567890'],
    ['common password', 'password1'],
    ['common password (case-insensitive)', 'PASSWORD1'],
    ['over 72 bytes', `A1${'x'.repeat(71)}`],
  ])('rejects a weak password: %s', async (_label, password) => {
    const res = await register({ ...valid, password });
    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    expect(body.error.details).toEqual([expect.objectContaining({ field: 'body.password' })]);
  });

  it('rejects a password containing the first name or email name', async () => {
    for (const password of ['Priya-2026x', 'sharma.2026x']) {
      const email = password.startsWith('sharma') ? 'sharma.2026x@example.com' : valid.email;
      const res = await register({ ...valid, email, password });
      const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
      expect(body.error.details).toEqual([
        { field: 'body.password', message: 'Must not contain your name or email' },
      ]);
    }
  });

  it('requires names, a valid email, phone, date of birth and accepted terms', async () => {
    const res = await register({ password: valid.password, email: 'bad', phone: '12' });
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    const fields = (body.error.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual([
      'body.acceptTerms',
      'body.dateOfBirth',
      'body.email',
      'body.firstName',
      'body.lastName',
      'body.phone',
    ]);
  });

  it.each([
    ['not a date', '17/05/1990'],
    ['impossible date', '1990-02-30'],
    ['in the future', '2999-01-01'],
    ['over 120 years ago', '1850-01-01'],
  ])('rejects a date of birth that is %s', async (_label, dateOfBirth) => {
    const res = await register({ ...valid, dateOfBirth });
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    expect(body.error.details).toEqual([expect.objectContaining({ field: 'body.dateOfBirth' })]);
  });

  it('requires acceptTerms to be exactly true', async () => {
    for (const acceptTerms of [false, 'yes']) {
      const res = await register({ ...valid, acceptTerms });
      const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
      expect(body.error.details).toEqual([
        { field: 'body.acceptTerms', message: 'You must accept the terms to create an account' },
      ]);
    }
  });
});

describe('register rate limiter', () => {
  it('allows 5 sign-ups per IP per hour', async () => {
    const app = express();
    app.use(requestId, createRegisterLimiter());
    app.post('/register', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    for (let i = 0; i < 5; i++) expect((await request(app).post('/register')).status).toBe(200);
    expect((await request(app).post('/register')).status).toBe(429);
  });
});
