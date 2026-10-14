import { Types } from 'mongoose';
import { loginAs, resetDb } from './helpers/auth.js';
import { ENDPOINTS, PUBLIC_ENDPOINTS, routeKey } from './helpers/rbacMatrix.js';
import { API_ROUTES } from './helpers/routes.js';
import { api } from './helpers/testApp.js';

/**
 * Security inventory (spec §10.2): walks the real /api/v1 router, so a new route cannot slip in
 * without authentication, admin-only protection or a row in the RBAC matrix.
 */

/** Routes that are public on purpose. Adding one here needs a reason. */
const PUBLIC = new Set([
  'GET /health',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh', // cookie + X-Requested-With instead of a Bearer token
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  // Clinic information for the public site and booking (spec §7.4–7.5)
  'GET /settings/public',
  'GET /departments',
  'GET /departments/:id',
  'GET /services',
  'GET /services/:id',
  'GET /doctors',
  'GET /doctors/:id',
  // Kiosk queue board: checks the kiosk key itself, no user login (spec §7.9)
  'GET /queue/board',
]);

/** Mount prefixes whose every route is admin-only. */
const ADMIN_PREFIXES = ['/users', '/audit-logs'];

const ROUTES = API_ROUTES;
const PROTECTED = ROUTES.filter((r) => !PUBLIC.has(r));
const withIds = (route: string) => route.replace(/:\w+/g, new Types.ObjectId().toString());

describe('route inventory', () => {
  it('finds the mounted routes', () => {
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(ROUTES).toContain('GET /users/:id');
    for (const pub of PUBLIC) expect(ROUTES).toContain(pub);
  });

  it('every protected route has a row in the RBAC matrix (and every row is a real route)', () => {
    const matrix = new Set(ENDPOINTS.map(routeKey));
    expect(PROTECTED.filter((r) => !matrix.has(r))).toEqual([]);
    expect([...matrix].filter((r) => !ROUTES.includes(r))).toEqual([]);
  });

  it('every public read is exercised by the RBAC matrix (every role and anonymous)', () => {
    const tested = new Set(PUBLIC_ENDPOINTS.map(routeKey));
    for (const key of tested) expect(PUBLIC.has(key), key).toBe(true);
    const publicReads = [...PUBLIC].filter(
      (r) => !r.startsWith('POST /auth') && r !== 'GET /health',
    );
    expect(publicReads.filter((r) => !tested.has(r))).toEqual([]);
  });

  it.each(PROTECTED)('%s → 401 without a token (authenticate)', async (route) => {
    const [method, path] = route.split(' ') as [string, string];
    const res = await api()[method.toLowerCase() as 'get'](`/api/v1${withIds(path)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
  });

  describe('admin-only routes', () => {
    let patientAuth: { Authorization: string };
    beforeAll(async () => {
      await resetDb();
      patientAuth = (await loginAs('patient')).auth;
    });

    const adminRoutes = PROTECTED.filter((r) =>
      ADMIN_PREFIXES.some((p) => r.split(' ')[1]!.startsWith(p)),
    );

    it('covers every route under the admin prefixes', () => {
      expect(adminRoutes.length).toBeGreaterThanOrEqual(10);
    });

    it.each(adminRoutes)('%s → 403 for a patient (authorize admin)', async (route) => {
      const [method, path] = route.split(' ') as [string, string];
      const res = await api()
        [method.toLowerCase() as 'get'](`/api/v1${withIds(path)}`)
        .set(patientAuth);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    });
  });
});
