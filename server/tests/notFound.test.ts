import { describe, expect, it } from 'vitest';
import { api, expectErrorShape } from './setup/testApp.js';

describe('404 handler', () => {
  it('returns NOT_FOUND in the standard error format for unknown API routes', async () => {
    const res = await api().get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    const body = expectErrorShape(res.body, 'NOT_FOUND');
    expect(body.message).toContain('/api/v1/does-not-exist');
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns NOT_FOUND for unsupported methods on existing paths', async () => {
    const res = await api().delete('/api/v1/health');
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
  });

  it('returns NOT_FOUND for paths outside /api/v1', async () => {
    const res = await api().get('/');
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
  });
});
