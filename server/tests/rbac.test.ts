import { Types } from 'mongoose';
import { ROLE_VALUES, type Role } from '../src/config/constants.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { api } from './helpers/testApp.js';

/**
 * RBAC matrix for every Phase 1 protected endpoint (spec §2.4, §15.1). Each role either passes
 * the role check (any status except 401/403) or gets 403. Public endpoints are covered elsewhere.
 * Extend this table as modules are added.
 */
type Method = 'get' | 'post' | 'patch' | 'delete';
const id = new Types.ObjectId().toString();
const ALL = ROLE_VALUES;
const ADMIN: readonly Role[] = ['admin'];

const ENDPOINTS: { method: Method; path: string; roles: readonly Role[]; body?: object }[] = [
  { method: 'get', path: '/auth/me', roles: ALL },
  { method: 'patch', path: '/auth/me', roles: ALL, body: { firstName: 'X' } },
  { method: 'get', path: '/auth/sessions', roles: ALL },
  { method: 'delete', path: `/auth/sessions/${id}`, roles: ALL },
  { method: 'post', path: '/auth/change-password', roles: ALL, body: {} },
  { method: 'post', path: '/auth/logout-all', roles: ALL },
  { method: 'post', path: '/auth/logout', roles: ALL },
  { method: 'get', path: '/users', roles: ADMIN },
  { method: 'post', path: '/users', roles: ADMIN, body: {} },
  { method: 'get', path: `/users/${id}`, roles: ADMIN },
  { method: 'patch', path: `/users/${id}`, roles: ADMIN, body: { firstName: 'X' } },
  { method: 'post', path: `/users/${id}/deactivate`, roles: ADMIN },
  { method: 'post', path: `/users/${id}/activate`, roles: ADMIN },
  { method: 'post', path: `/users/${id}/reset-password`, roles: ADMIN },
  { method: 'post', path: `/users/${id}/unlock`, roles: ADMIN },
  { method: 'get', path: '/audit-logs', roles: ADMIN },
  { method: 'get', path: '/audit-logs/verify', roles: ADMIN },
];

const sessions = {} as Record<Role, LoggedIn>;

describe('RBAC matrix (Phase 1 endpoints)', () => {
  beforeAll(async () => {
    await resetDb();
  });

  // A fresh login per role per endpoint: logout and logout-all revoke the caller's session.
  beforeEach(async () => {
    for (const role of ALL) sessions[role] = await loginAs(role);
  });

  for (const { method, path, roles, body } of ENDPOINTS) {
    for (const role of ALL) {
      const allowed = roles.includes(role);
      it(`${method.toUpperCase()} ${path} as ${role} → ${allowed ? 'allowed' : '403'}`, async () => {
        let req = api()[method](`/api/v1${path}`).set(sessions[role].auth);
        if (body) req = req.send(body);
        const res = await req;
        if (allowed) expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }

  it('every protected endpoint returns 401 without a token', async () => {
    for (const { method, path } of ENDPOINTS) {
      const res = await api()[method](`/api/v1${path}`);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});
