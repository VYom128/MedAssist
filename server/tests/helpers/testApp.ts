import type { Router } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/** Supertest agent for the real app, optionally with test-only routes mounted before notFound. */
export const api = (extraRoutes?: Router) => request(createApp({ extraRoutes }));

export interface ErrorBody {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
  requestId: string;
}

/** Asserts the standard error envelope (spec §7.1) and returns the typed body. */
export function expectErrorShape(body: unknown, code: string): ErrorBody {
  expect(body).toMatchObject({
    success: false,
    message: expect.any(String),
    error: { code },
    requestId: expect.any(String),
  });
  return body as ErrorBody;
}
