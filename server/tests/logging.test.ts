import { Router } from 'express';
import mongoose from 'mongoose';
import { symbols } from 'pino';
import { logger } from '../src/utils/logger.js';
import { asyncHandler } from '../src/utils/asyncHandler.js';
import { api } from './helpers/testApp.js';

const SENSITIVE = 'SENSITIVE-PATIENT-DATA-7f3a';

const Unique = mongoose.model(
  'LoggingUnique',
  new mongoose.Schema({ mrn: { type: String, unique: true } }),
);

const router = Router();
router.post('/test/boom', () => {
  throw new Error('boom');
});
router.post(
  '/test/dup',
  asyncHandler(async (req) => {
    await Unique.create({ mrn: req.body.mrn });
    await Unique.create({ mrn: req.body.mrn });
  }),
);

/**
 * Captures the logger's real serialized output. The logger is silent in tests, so raise the
 * level and swap its output stream for an in-memory one (child loggers created by pino-http
 * per request inherit both).
 */
function captureLogs() {
  const lines: string[] = [];
  const target = logger as unknown as Record<symbol, unknown>;
  const streamSym = symbols.streamSym;
  const originalStream = target[streamSym];
  const originalLevel = logger.level;
  target[streamSym] = { write: (line: string) => lines.push(line) };
  logger.level = 'trace';
  return {
    text: () => lines.join(''),
    restore: () => {
      target[streamSym] = originalStream;
      logger.level = originalLevel;
    },
  };
}

describe('logging never includes request data', () => {
  beforeAll(async () => {
    await Unique.init();
  });

  it.each([
    ['a 500 error', '/test/boom', { name: SENSITIVE }, 50],
    ['a duplicate-key error', '/test/dup', { mrn: SENSITIVE }, 40],
  ])('%s does not log the request body', async (_label, path, body, level) => {
    const logs = captureLogs();
    try {
      await api(router).post(path).send(body);
      expect(logs.text()).toContain(`"level":${level}`); // the error was logged
      expect(logs.text()).not.toContain(SENSITIVE);
    } finally {
      logs.restore();
    }
  });

  it('malformed JSON does not log the raw body', async () => {
    const logs = captureLogs();
    try {
      await api(router)
        .post('/test/boom')
        .set('Content-Type', 'application/json')
        .send(`{"name": "${SENSITIVE}", `);
      expect(logs.text()).toContain('Malformed JSON');
      expect(logs.text()).not.toContain(SENSITIVE);
    } finally {
      logs.restore();
    }
  });
});

describe('request logs and auth flows', () => {
  it('logs the path without the query string', async () => {
    const logs = captureLogs();
    try {
      await api().get(`/api/v1/health?q=${SENSITIVE}`);
    } finally {
      logs.restore();
    }
    expect(logs.text()).toContain('/api/v1/health');
    expect(logs.text()).not.toContain(SENSITIVE);
  });

  it('never logs passwords, tokens, hashes or cookies during a full auth flow', async () => {
    const { resetDb, refreshWith, refreshCookieFrom } = await import('./helpers/auth.js');
    const { captureEmails } = await import('./helpers/email.js');
    await resetDb();
    const emails = captureEmails();
    const PASSWORD = 'Logging-2026-pass';
    const NEW_PASSWORD = 'Logging-2027-pass';
    const logs = captureLogs();
    const secrets: string[] = [PASSWORD, NEW_PASSWORD];
    try {
      const reg = await api()
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Meera',
          lastName: 'Check',
          email: 'logcheck@example.com',
          phone: '+919800000001',
          dateOfBirth: '1990-01-01',
          password: PASSWORD,
          acceptTerms: true,
          consent: { dataProcessing: true },
        });
      const access = reg.body.data.accessToken as string;
      const cookie = refreshCookieFrom(reg) ?? '';
      secrets.push(access, cookie);

      const refreshed = await refreshWith(cookie);
      secrets.push(refreshed.body.data.accessToken, refreshCookieFrom(refreshed) ?? '');
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'logcheck@example.com', password: 'Wrong-pass-9' });
      await api()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      await api().post('/api/v1/auth/forgot-password').send({ email: 'logcheck@example.com' });
      const token = await emails.lastToken();
      secrets.push(token);
      await api()
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'Logging-2028-pass' });
      secrets.push('Logging-2028-pass');
    } finally {
      logs.restore();
      emails.restore();
    }
    const text = logs.text();
    expect(text.length).toBeGreaterThan(0);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/passwordHash|refreshTokenHash|tokenHash|ma_rt=|\$2[aby]\$/);
  });
});
