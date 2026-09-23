import { Router } from 'express';
import { sendSuccess } from '../src/utils/ApiResponse.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const router = Router();
router.post('/test/echo', (req, res) => sendSuccess(res, { data: req.body }));

describe('request body parsing', () => {
  it('malformed JSON → 400 BAD_REQUEST', async () => {
    const res = await api(router)
      .post('/test/echo')
      .set('Content-Type', 'application/json')
      .send('{"bad": ');

    expect(res.status).toBe(400);
    expect(expectErrorShape(res.body, 'BAD_REQUEST').message).toBe('Malformed JSON');
  });

  it('body over 1 mb → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await api(router)
      .post('/test/echo')
      .send({ blob: 'x'.repeat(1024 * 1024 + 1) });

    expect(res.status).toBe(413);
    expectErrorShape(res.body, 'PAYLOAD_TOO_LARGE');
  });
});
