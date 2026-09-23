import { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validate } from '../src/middlewares/validate.js';
import { sendSuccess } from '../src/utils/ApiResponse.js';
import { api, expectErrorShape } from './setup/testApp.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const router = Router();
router.post(
  '/items/:id',
  validate({
    params: z.object({ id: objectId }),
    query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
    body: z.object({ name: z.string().trim().min(2), qty: z.number().int().positive() }),
  }),
  (req, res) =>
    sendSuccess(res, { data: { params: req.params, query: req.query, body: req.body } }),
);

const testApi = () => api({ mount: (app) => app.use('/api/v1/__test', router) });
const validId = '64b7f0c2a1b2c3d4e5f60718';

describe('validate() middleware', () => {
  it('passes parsed, coerced and stripped values to the handler', async () => {
    const res = await testApi()
      .post(`/api/v1/__test/items/${validId}?page=3`)
      .send({ name: '  Paracetamol ', qty: 2, extra: 'dropped' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'OK',
      data: {
        params: { id: validId },
        query: { page: 3 },
        body: { name: 'Paracetamol', qty: 2 },
      },
    });
  });

  it('applies defaults', async () => {
    const res = await testApi()
      .post(`/api/v1/__test/items/${validId}`)
      .send({ name: 'Ab', qty: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.query).toEqual({ page: 1 });
  });

  it('returns 400 VALIDATION_ERROR with per-field details from params, query and body', async () => {
    const res = await testApi()
      .post('/api/v1/__test/items/not-an-id?page=0')
      .send({ name: 'A', qty: -1 });

    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    const details = body.error.details as { path: string; message: string }[];
    expect(details.map((d) => d.path).sort()).toEqual([
      'body.name',
      'body.qty',
      'params.id',
      'query.page',
    ]);
    expect(details.find((d) => d.path === 'params.id')?.message).toBe('Invalid id');
  });

  it('rejects a missing body', async () => {
    const res = await testApi().post(`/api/v1/__test/items/${validId}`);
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'VALIDATION_ERROR');
  });
});
