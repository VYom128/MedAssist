import { describe, expect, it, vi } from 'vitest';
import { api, expectErrorShape } from './setup/testApp.js';

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

  it('echoes a safe incoming X-Request-Id and replaces an unsafe one', async () => {
    const safe = await api().get('/api/v1/health').set('X-Request-Id', 'trace-abc-12345');
    expect(safe.headers['x-request-id']).toBe('trace-abc-12345');

    const unsafe = await api().get('/api/v1/nope').set('X-Request-Id', 'bad id <script>');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id <script>');
    expect(unsafe.body.requestId).toBe(unsafe.headers['x-request-id']);
  });

  it('returns 429 RATE_LIMITED after the limit is exceeded', async () => {
    vi.stubEnv('RATE_LIMIT_MAX', '3');
    vi.resetModules();
    const { createApp } = await import('../src/app.js');
    const { default: request } = await import('supertest');
    const app = createApp();

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/api/v1/health')).status).toBe(200);
    }
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(429);
    expectErrorShape(res.body, 'RATE_LIMITED');

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
