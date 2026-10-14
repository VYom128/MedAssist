import express from 'express';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { apiLimiter, apiLimiterKey, createRateLimiter } from '../src/middlewares/rateLimiters.js';
import { signAccessToken } from '../src/utils/tokens.js';
import { requestId } from '../src/middlewares/requestId.js';
import { api, expectErrorShape, serve } from './helpers/testApp.js';

describe('security middleware', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    // HSTS (spec §10.3): browsers keep to HTTPS for a year, subdomains included.
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000; includeSubDomains/);
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
      expect((await (await serve(app))().get('/ping')).status).toBe(200);
    }
    const res = await (await serve(app))().get('/ping');
    expect(res.status).toBe(429);
    expectErrorShape(res.body, 'RATE_LIMITED');
  });

  it('skips the global API limiter when NODE_ENV=test', async () => {
    const app = express();
    app.use(apiLimiter);
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    const res = await (await serve(app))().get('/ping');
    expect(res.headers['ratelimit-policy']).toBeUndefined();
  });
});

describe('global limiter key (D197)', () => {
  const token = (sub: string) =>
    signAccessToken({ sub, role: 'receptionist', sid: '64b000000000000000000001' });
  const bearer = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });

  /** An app whose limiter allows 2 requests per key, like apiLimiter with a tiny budget. */
  async function limited() {
    const app = express();
    app.use(requestId);
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2, keyGenerator: apiLimiterKey }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return serve(app);
  }

  it('signed-in users each get their own budget, even from one address', async () => {
    const call = await limited();
    const a = '64b0000000000000000000aa';
    const b = '64b0000000000000000000bb';
    expect((await call().get('/ping').set(bearer(a))).status).toBe(200);
    expect((await call().get('/ping').set(bearer(a))).status).toBe(200);
    expect((await call().get('/ping').set(bearer(a))).status).toBe(429);
    expect((await call().get('/ping').set(bearer(b))).status).toBe(200);
    // Anonymous callers from the same address have their own (IP) budget.
    expect((await call().get('/ping')).status).toBe(200);
  });

  it('a forged or malformed token counts against the IP, not a user', async () => {
    const call = await limited();
    const forged = { Authorization: `Bearer ${token('64b0000000000000000000aa').slice(0, -2)}xx` };
    expect((await call().get('/ping').set(forged)).status).toBe(200);
    expect((await call().get('/ping').set({ Authorization: 'Bearer not-a-jwt' })).status).toBe(200);
    expect((await call().get('/ping')).status).toBe(429); // same IP bucket, third request
  });

  it('keys: user:<id> for a valid token, ip:<address> otherwise', () => {
    const req = (authorization?: string) =>
      ({ headers: authorization ? { authorization } : {}, ip: '203.0.113.7' }) as never;
    expect(apiLimiterKey(req(`Bearer ${token('64b0000000000000000000aa')}`))).toBe(
      'user:64b0000000000000000000aa',
    );
    expect(apiLimiterKey(req('Bearer junk'))).toBe('ip:203.0.113.7');
    expect(apiLimiterKey(req())).toBe('ip:203.0.113.7');
  });
});

describe('NoSQL operator keys (spec §10.3)', () => {
  it('rejects `$` keys in the body before the route – the classic login bypass', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $gt: '' } });
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'body.email.$ne', message: 'Keys may not start with "$" or contain "."' },
    ]);
  });

  it('rejects them in the query string (qs nesting) and inside arrays', async () => {
    const query = await api().get('/api/v1/patients?q[$regex]=.*');
    expect(query.status).toBe(400);
    expect(query.body.error.details[0].field).toBe('query.q.$regex');

    const nested = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.dev', password: 'x', extra: [{ ok: 1 }, { $where: 'sleep(1)' }] });
    expect(nested.body.error.details[0].field).toBe('body.extra.1.$where');
  });

  it('rejects dotted keys (path injection), and the response never echoes values', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.dev', password: 'secret-value', 'role.admin': true });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('body.role.admin');
    expect(JSON.stringify(res.body)).not.toContain('secret-value');
  });

  it('leaves ordinary requests alone ($ and . inside values are fine)', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'no.one@example.com', password: '$ecret.pass' });
    expect(res.status).toBe(401);
  });
});
