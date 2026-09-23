import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { apiLimiter, createRateLimiter } from '../src/middlewares/rateLimiters.js';
import { requestId } from '../src/middlewares/requestId.js';
import { api, expectErrorShape } from './helpers/testApp.js';

describe('security middleware', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS with credentials only for CLIENT_URL', async () => {
    const allowed = await api().get('/api/v1/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const other = await api().get('/api/v1/health').set('Origin', 'https://evil.example.com');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });

  it('allows the Authorization and X-Requested-With headers in CORS preflight', async () => {
    const res = await api()
      .options('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,x-requested-with,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toMatch(/x-requested-with/i);
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it('returns 429 RATE_LIMITED in the standard format after the limit is exceeded', async () => {
    const app = express();
    app.use(requestId);
    app.use(createRateLimiter({ windowMs: 60_000, limit: 3 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/ping')).status).toBe(200);
    }
    const res = await request(app).get('/ping');
    expect(res.status).toBe(429);
    expectErrorShape(res.body, 'RATE_LIMITED');
  });

  it('skips the global API limiter when NODE_ENV=test', async () => {
    const app = express();
    app.use(apiLimiter);
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/ping');
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });
});
