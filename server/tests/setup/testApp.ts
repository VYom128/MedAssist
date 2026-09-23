import request from 'supertest';
import { createApp, type CreateAppOptions } from '../../src/app.js';

export const api = (options?: CreateAppOptions) => request(createApp(options));

/** Asserts the standard error envelope (spec §7.1) and returns its body. */
export function expectErrorShape(
  body: Record<string, unknown>,
  code: string,
): { message: string; error: { code: string; details?: unknown }; requestId: string } {
  const typed = body as {
    success: boolean;
    message: string;
    error: { code: string; details?: unknown };
    requestId: string;
  };
  if (typed.success !== false)
    throw new Error(`Expected success=false, got ${JSON.stringify(body)}`);
  if (typed.error?.code !== code)
    throw new Error(`Expected code ${code}, got ${JSON.stringify(body)}`);
  if (typeof typed.message !== 'string' || typeof typed.requestId !== 'string') {
    throw new Error(`Missing message/requestId: ${JSON.stringify(body)}`);
  }
  return typed;
}
