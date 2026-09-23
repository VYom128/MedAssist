import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../src/middlewares/validate.js';
import { sendSuccess } from '../src/utils/ApiResponse.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const router = Router();
router.post(
  '/test/validate',
  validate({ body: z.object({ name: z.string().min(2), age: z.number().int().positive() }) }),
  (req, res) => sendSuccess(res, { data: req.body }),
);
router.get(
  '/test/validate/:id',
  validate({
    params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') }),
    query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
  }),
  (req, res) => sendSuccess(res, { data: { params: req.params, query: req.query } }),
);

const validId = '64b7f0c2a1b2c3d4e5f60718';

describe('validate() middleware', () => {
  it('returns 400 VALIDATION_ERROR with details for every invalid field', async () => {
    const res = await api(router).post('/test/validate').send({ name: 'A', age: -3.5 });

    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    const details = body.error.details as { field: string; message: string }[];
    expect([...new Set(details.map((d) => d.field))].sort()).toEqual(['body.age', 'body.name']);
    details.forEach((d) => expect(d.message).toEqual(expect.any(String)));
  });

  it('rejects a missing body', async () => {
    const res = await api(router).post('/test/validate');
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'VALIDATION_ERROR');
  });

  it('passes a valid body with unknown fields stripped', async () => {
    const res = await api(router)
      .post('/test/validate')
      .send({ name: 'Asha', age: 34, isAdmin: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'OK', data: { name: 'Asha', age: 34 } });
  });

  it('validates and coerces query and params', async () => {
    const ok = await api(router).get(`/test/validate/${validId}?page=3&junk=1`);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ params: { id: validId }, query: { page: 3 } });

    const defaulted = await api(router).get(`/test/validate/${validId}`);
    expect(defaulted.body.data.query).toEqual({ page: 1 });

    const bad = await api(router).get('/test/validate/nope?page=0');
    expect(bad.status).toBe(400);
    const details = expectErrorShape(bad.body, 'VALIDATION_ERROR').error.details as {
      field: string;
    }[];
    expect(details.map((d) => d.field).sort()).toEqual(['params.id', 'query.page']);
  });
});
