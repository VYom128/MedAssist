import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { sendSuccess } from '../src/utils/ApiResponse.js';
import { api, expectErrorShape } from './setup/testApp.js';

const router = Router();
router.post('/echo', (req, res) => sendSuccess(res, { data: req.body }));
const testApi = () => api({ mount: (app) => app.use('/api/v1/__test', router) });

describe('request body parsing', () => {
  it('returns 400 BAD_REQUEST for malformed JSON', async () => {
    const res = await testApi()
      .post('/api/v1/__test/echo')
      .set('Content-Type', 'application/json')
      .send('{"name": "oops",');

    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'BAD_REQUEST');
    expect(body.message).toBe('Malformed JSON in request body');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for oversized JSON bodies', async () => {
    const res = await testApi()
      .post('/api/v1/__test/echo')
      .send({ blob: 'x'.repeat(200 * 1024) });

    expect(res.status).toBe(413);
    expectErrorShape(res.body, 'PAYLOAD_TOO_LARGE');
  });

  it('accepts valid JSON', async () => {
    const res = await testApi().post('/api/v1/__test/echo').send({ ok: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ok: true });
  });
});
