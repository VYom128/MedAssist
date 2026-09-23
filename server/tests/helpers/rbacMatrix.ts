import { ROLE_VALUES, type Role } from '../../src/config/constants.js';
import type { LoggedIn } from './auth.js';
import { TEST_PASSWORD } from './auth.js';

/**
 * RBAC matrix rows (spec §2.4, §15.1): every protected endpoint with the roles allowed and the
 * exact status an allowed role gets (the request is built to be valid). Used by rbac.test.ts
 * (every role × every row) and routeInventory.test.ts (every mounted route must have a row).
 *
 * Adding an endpoint: add one row here. `path` builds a valid URL from the context; `body` a
 * valid body. Routes with `:id` use the ids in Ctx (extend Ctx and buildContext if you need
 * another fixture).
 */

export type Method = 'get' | 'post' | 'patch' | 'delete';

export interface Ctx {
  me: LoggedIn;
  /** An active staff user the admin endpoints act on. */
  targetId: string;
  /** An inactive staff user (for activate). */
  inactiveId: string;
  /** Another session of the caller (for DELETE /auth/sessions/:id). */
  otherSessionId: string;
  /** Unique per test (for POST /users). */
  n: number;
}

export interface Row {
  method: Method;
  path: (c: Ctx) => string;
  body?: (c: Ctx) => object;
  roles: readonly Role[];
  status: number;
}

export const ALL = ROLE_VALUES;
export const ADMIN: readonly Role[] = ['admin'];

export const ENDPOINTS: Row[] = [
  // Auth (any logged-in user)
  { method: 'get', path: () => '/auth/me', roles: ALL, status: 200 },
  {
    method: 'patch',
    path: () => '/auth/me',
    body: () => ({ firstName: 'Changed' }),
    roles: ALL,
    status: 200,
  },
  { method: 'get', path: () => '/auth/sessions', roles: ALL, status: 200 },
  { method: 'delete', path: (c) => `/auth/sessions/${c.otherSessionId}`, roles: ALL, status: 200 },
  {
    method: 'post',
    path: () => '/auth/change-password',
    body: () => ({ currentPassword: TEST_PASSWORD, newPassword: 'Matrix-2026x' }),
    roles: ALL,
    status: 200,
  },
  { method: 'post', path: () => '/auth/logout-all', roles: ALL, status: 200 },
  { method: 'post', path: () => '/auth/logout', roles: ALL, status: 200 },
  // Users (admin)
  { method: 'get', path: () => '/users', roles: ADMIN, status: 200 },
  {
    method: 'post',
    path: () => '/users',
    body: (c) => ({
      firstName: 'New',
      lastName: 'Staff',
      email: `new${c.n}@clinic.dev`,
      role: 'labtech',
    }),
    roles: ADMIN,
    status: 201,
  },
  { method: 'get', path: (c) => `/users/${c.targetId}`, roles: ADMIN, status: 200 },
  {
    method: 'patch',
    path: (c) => `/users/${c.targetId}`,
    body: () => ({ firstName: 'X' }),
    roles: ADMIN,
    status: 200,
  },
  { method: 'post', path: (c) => `/users/${c.targetId}/deactivate`, roles: ADMIN, status: 200 },
  { method: 'post', path: (c) => `/users/${c.inactiveId}/activate`, roles: ADMIN, status: 200 },
  { method: 'post', path: (c) => `/users/${c.targetId}/reset-password`, roles: ADMIN, status: 200 },
  { method: 'post', path: (c) => `/users/${c.targetId}/unlock`, roles: ADMIN, status: 200 },
  // Audit logs (admin)
  { method: 'get', path: () => '/audit-logs', roles: ADMIN, status: 200 },
  { method: 'get', path: () => '/audit-logs/verify', roles: ADMIN, status: 200 },
];

/** Placeholder context: turns a row's `path` into the Express pattern (`/users/:id`). */
export const PATTERN_CTX = {
  targetId: ':id',
  inactiveId: ':id',
  otherSessionId: ':id',
  n: 0,
} as unknown as Ctx;

/** "GET /users/:id" for a row. */
export const routeKey = (row: Row) => `${row.method.toUpperCase()} ${row.path(PATTERN_CTX)}`;
