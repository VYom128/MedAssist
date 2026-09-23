import { api, expectErrorShape } from './helpers/testApp.js';

describe('404 handler', () => {
  it('returns 404 NOT_FOUND in the standard error format', async () => {
    const res = await api().get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    const body = expectErrorShape(res.body, 'NOT_FOUND');
    expect(body.message).toBe('Route not found: GET /api/v1/does-not-exist');
    expect(body.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns 404 for unsupported methods and paths outside /api/v1', async () => {
    expectErrorShape((await api().delete('/api/v1/health')).body, 'NOT_FOUND');
    expectErrorShape((await api().get('/')).body, 'NOT_FOUND');
  });
});
