import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const API = 'http://localhost:5001/api/v1';

/** `${API}${path}` for MSW handlers. */
export const url = (path: string) => `${API}${path}`;

/** Standard success envelope (spec §7.1). */
export const ok = (
  data: unknown,
  {
    status = 200,
    message = 'OK',
    meta,
  }: { status?: number; message?: string; meta?: unknown } = {},
) => HttpResponse.json({ success: true, message, data, ...(meta ? { meta } : {}) }, { status });

/** Standard error envelope. */
export const fail = (status: number, code: string, message = 'Error', details?: unknown) =>
  HttpResponse.json(
    {
      success: false,
      message,
      error: { code, ...(details ? { details } : {}) },
      requestId: 'req-test',
    },
    { status },
  );

/**
 * Default handlers: the session restore on page load finds no session. Tests add their own with
 * `server.use(...)`; any request without a handler fails the test.
 */
export const handlers = [
  http.post(url('/auth/refresh'), () => fail(401, 'SESSION_REVOKED', 'No active session')),
];

export const server = setupServer(...handlers);
