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

/** Public clinic settings used by default (GET /settings/public). */
export const PUBLIC_SETTINGS = {
  name: 'MedAssist Clinic',
  logoUrl: null,
  tagline: null,
  address: {
    line1: null,
    line2: null,
    city: 'Bengaluru',
    state: null,
    postalCode: null,
    country: 'India',
  },
  phone: null,
  email: null,
  website: null,
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  workingDays: [1, 2, 3, 4, 5, 6],
  appointment: { allowPatientSelfBooking: true, bookingWindowDays: 30, minCancelHours: 2 },
  ai: { explanationLanguages: ['en', 'hi'] },
};

/**
 * Default handlers: the session restore on page load finds no session. Tests add their own with
 * `server.use(...)`; any request without a handler fails the test.
 */
export const handlers = [
  http.post(url('/auth/refresh'), () => fail(401, 'SESSION_REVOKED', 'No active session')),
  http.get(url('/settings/public'), () => ok(PUBLIC_SETTINGS)),
  // Reception's sidebar badge.
  http.get(url('/patients/pending-links'), () =>
    ok([], { meta: { page: 1, limit: 1, total: 0, totalPages: 0 } }),
  ),
];

export const server = setupServer(...handlers);
