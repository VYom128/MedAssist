import { api } from './helpers/testApp.js';

describe('requestId middleware', () => {
  it('echoes an incoming X-Request-Id', async () => {
    const res = await api().get('/api/v1/health').set('X-Request-Id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('uses the same id in the error body', async () => {
    const res = await api().get('/api/v1/nope').set('X-Request-Id', 'trace-err-67890');
    expect(res.body.requestId).toBe('trace-err-67890');
  });

  it('generates a UUID when the header is missing', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('replaces an unsafe incoming id (log/header injection guard)', async () => {
    const res = await api().get('/api/v1/health').set('X-Request-Id', 'bad id <script>');
    expect(res.headers['x-request-id']).not.toBe('bad id <script>');
  });
});
