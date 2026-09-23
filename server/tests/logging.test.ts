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
