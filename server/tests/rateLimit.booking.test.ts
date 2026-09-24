import express, { type RequestHandler } from 'express';
import type { Role } from '../src/config/constants.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import {
  createBoardLimiter,
  createPatientBookingLimiter,
} from '../src/middlewares/rateLimiters.js';
import { requestId } from '../src/middlewares/requestId.js';
import { expectErrorShape, serve } from './helpers/testApp.js';

/** Phase 4 rate limits: patient bookings/reschedules per user, and the kiosk board per IP. */

/** Stand-in for `authenticate`: the caller comes from headers. */
const fakeAuth: RequestHandler = (req, _res, next) => {
  req.user = {
    id: req.get('x-user') ?? 'u1',
    role: (req.get('x-role') ?? 'patient') as Role,
  } as never;
  next();
};

describe('patient booking limiter', () => {
  async function app() {
    const a = express();
    a.use(requestId, fakeAuth, createPatientBookingLimiter());
    a.post('/book', (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    return serve(a);
  }

  it('allows 20 bookings/reschedules per patient per hour, then 429 RATE_LIMITED', async () => {
    const call = await app();
    for (let i = 0; i < 20; i += 1) {
      expect((await call().post('/book').set('x-user', 'p1')).status).toBe(200);
    }
    const res = await call().post('/book').set('x-user', 'p1');
    expect(res.status).toBe(429);
    expectErrorShape(res.body, 'RATE_LIMITED');
    // Another patient has their own budget.
    expect((await call().post('/book').set('x-user', 'p2')).status).toBe(200);
  });

  it('does not limit staff', async () => {
    const call = await app();
    for (let i = 0; i < 25; i += 1) {
      const res = await call().post('/book').set('x-user', 'r1').set('x-role', 'receptionist');
      expect(res.status).toBe(200);
    }
  });
});

describe('queue board limiter', () => {
  it('allows 60 requests per minute per IP', async () => {
    const a = express();
    a.use(requestId, createBoardLimiter());
    a.get('/board', (_req, res) => res.json({ ok: true }));
    a.use(errorHandler);
    const call = await serve(a);
    for (let i = 0; i < 60; i += 1) expect((await call().get('/board')).status).toBe(200);
    expect((await call().get('/board')).status).toBe(429);
  });
});
