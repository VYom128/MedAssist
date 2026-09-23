import { Router } from 'express';
import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../src/utils/ApiError.js';
import { asyncHandler } from '../src/utils/asyncHandler.js';
import { api, expectErrorShape } from './setup/testApp.js';

const Thing = mongoose.model(
  'ErrorHandlerThing',
  new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    age: { type: Number, min: 0 },
  }),
);

const router = Router();
router.get('/api-error', () => {
  throw new ApiError('CONFLICT', 'Already exists', { field: 'email' });
});
router.get(
  '/async-api-error',
  asyncHandler(async () => {
    throw ApiError.forbidden();
  }),
);
router.get(
  '/unknown',
  asyncHandler(async () => {
    throw new Error('secret internal detail');
  }),
);
router.get('/zod', () => {
  z.object({ a: z.string() }).parse({ a: 1 });
});
router.get(
  '/cast/:id',
  asyncHandler(async (req) => {
    await Thing.findById(req.params.id);
  }),
);
router.get(
  '/mongoose-validation',
  asyncHandler(async () => {
    await Thing.create({ age: -5 });
  }),
);
router.get(
  '/duplicate',
  asyncHandler(async () => {
    await Thing.create({ email: 'dup@example.com' });
    await Thing.create({ email: 'dup@example.com' });
  }),
);

const testApi = () => api({ mount: (app) => app.use('/api/v1/__test', router) });

describe('errorHandler', () => {
  beforeAll(async () => {
    await Thing.init(); // build the unique index before the duplicate test
  });

  it('sends ApiError status, code, message and details', async () => {
    const res = await testApi().get('/api/v1/__test/api-error');
    expect(res.status).toBe(409);
    const body = expectErrorShape(res.body, 'CONFLICT');
    expect(body.message).toBe('Already exists');
    expect(body.error.details).toEqual({ field: 'email' });
  });

  it('handles errors thrown from async handlers', async () => {
    const res = await testApi().get('/api/v1/__test/async-api-error');
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'FORBIDDEN');
  });

  it('hides unknown errors behind a generic 500 INTERNAL_ERROR', async () => {
    const res = await testApi().get('/api/v1/__test/unknown');
    expect(res.status).toBe(500);
    const body = expectErrorShape(res.body, 'INTERNAL_ERROR');
    expect(body.message).toBe('Something went wrong');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(JSON.stringify(res.body)).not.toContain('stack');
  });

  it('maps a ZodError to 400 VALIDATION_ERROR', async () => {
    const res = await testApi().get('/api/v1/__test/zod');
    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ path: 'a', message: expect.any(String) }]);
  });

  it('maps a Mongoose CastError to 400 BAD_REQUEST', async () => {
    const res = await testApi().get('/api/v1/__test/cast/not-an-object-id');
    expect(res.status).toBe(400);
    expectErrorShape(res.body, 'BAD_REQUEST');
  });

  it('maps a Mongoose ValidationError to 400 VALIDATION_ERROR', async () => {
    const res = await testApi().get('/api/v1/__test/mongoose-validation');
    expect(res.status).toBe(400);
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    const paths = (body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['age', 'email']);
  });

  it('maps a duplicate key error to 409 CONFLICT without echoing the value', async () => {
    const res = await testApi().get('/api/v1/__test/duplicate');
    expect(res.status).toBe(409);
    const body = expectErrorShape(res.body, 'CONFLICT');
    expect(body.error.details).toEqual({ fields: ['email'] });
    expect(JSON.stringify(res.body)).not.toContain('dup@example.com');
  });
});
