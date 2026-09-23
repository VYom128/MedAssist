import type { Router } from 'express';
import { Types } from 'mongoose';
import apiRoutes from '../src/routes/index.js';
import { loginAs, resetDb } from './helpers/auth.js';
import { ENDPOINTS, PUBLIC_ENDPOINTS, routeKey } from './helpers/rbacMatrix.js';
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
]);

/** Mount prefixes whose every route is admin-only. */
const ADMIN_PREFIXES = ['/users', '/audit-logs'];

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

/** "/users" from Express 4's mount regexp `^\/users\/?(?=\/|$)`. */
function mountPath(regexp: RegExp): string {
  return regexp.source.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\\(.)/g, '$1');
}

function listRoutes(stack: Layer[], prefix = ''): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replace(/(.)\/$/, '$1');
      return Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${path}`);
    }
    if (layer.name === 'router' && layer.handle.stack) {
      return listRoutes(layer.handle.stack, `${prefix}${mountPath(layer.regexp)}`);
    }
    return [];
  });
}

const ROUTES = listRoutes((apiRoutes as unknown as Router & { stack: Layer[] }).stack);
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
    expect(res.status).toBe(401);
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
      expect(res.status).toBe(403);
    });
  });
});
