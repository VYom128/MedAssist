import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../src/utils/ApiError.js';
import { asyncHandler } from '../src/utils/asyncHandler.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const TestThing = mongoose.model(
  'TestThing',
  new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    age: { type: Number, min: 0 },
  }),
);

const router = Router();
router.get('/test/conflict', () => {
  throw ApiError.conflict('Already exists', { field: 'email' });
});
router.get('/test/plain-error', () => {
  throw new Error('secret internal detail');
});
router.get(
  '/test/async-rejection',
  asyncHandler(async () => {
    await Promise.resolve();
    throw ApiError.forbidden();
  }),
);
router.get(
  '/test/cast',
  asyncHandler(async () => {
    await TestThing.findById('bad-id');
  }),
);
router.get(
  '/test/duplicate',
  asyncHandler(async () => {
    await TestThing.create({ email: 'dup@example.com' });
    await TestThing.create({ email: 'dup@example.com' });
  }),
);
router.get(
  '/test/mongoose-validation',
  asyncHandler(async () => {
    await TestThing.create({ age: -5 });
  }),
);
router.get('/test/zod', () => {
  z.object({ a: z.string() }).parse({ a: 1 });
});

describe('errorHandler', () => {
  beforeAll(async () => {
    await TestThing.init(); // build the unique index before the duplicate test
  });

  it('ApiError.conflict → 409 CONFLICT with message and details', async () => {
    const res = await api(router).get('/test/conflict');
    expect(res.status).toBe(409);
    const body = expectErrorShape(res.body, 'CONFLICT');
    expect(body.message).toBe('Already exists');
    expect(body.error.details).toEqual({ field: 'email' });
  });

  it('plain Error → 500 INTERNAL_ERROR without leaking the message or stack', async () => {
    const res = await api(router).get('/test/plain-error');
    expect(res.status).toBe(500);
    expect(expectErrorShape(res.body, 'INTERNAL_ERROR').message).toBe('Something went wrong');
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
    expect(res.body).not.toHaveProperty('stack');
  });

  it('rejected promise in an asyncHandler route is caught', async () => {
    const res = await api(router).get('/test/async-rejection');
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'FORBIDDEN');
  });

  it("Mongoose CastError (findById('bad-id')) → 400 BAD_REQUEST", async () => {
    const res = await api(router).get('/test/cast');
    expect(res.status).toBe(400);
    expect(expectErrorShape(res.body, 'BAD_REQUEST').message).toBe('Invalid _id');
  });

  it('duplicate key → 409 CONFLICT naming the field, not the value', async () => {
    const res = await api(router).get('/test/duplicate');
    expect(res.status).toBe(409);
    const body = expectErrorShape(res.body, 'CONFLICT');
    expect(body.message).toBe('Duplicate value for email');
    expect(body.error.details).toEqual({ fields: ['email'] });
    expect(JSON.stringify(res.body)).not.toContain('dup@example.com');
  });

  it('Mongoose ValidationError → 400 VALIDATION_ERROR with field details', async () => {
    const res = await api(router).get('/test/mongoose-validation');
    expect(res.status).toBe(400);
    const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
      field: string;
    }[];
    expect(details.map((d) => d.field).sort()).toEqual(['age', 'email']);
  });

  it('ZodError thrown in a handler → 400 VALIDATION_ERROR', async () => {
    const res = await api(router).get('/test/zod');
    expect(res.status).toBe(400);
    expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual([
      { field: 'a', message: expect.any(String) },
    ]);
  });
});
