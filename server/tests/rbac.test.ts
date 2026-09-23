import { ROLE_VALUES, type Role } from '../src/config/constants.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { createUser, loginAs, resetDb, TEST_PASSWORD, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { api } from './helpers/testApp.js';

/**
 * RBAC matrix (spec §2.4, §15.1): every protected endpoint × every role. A role in `roles` must
 * get exactly `status` (the request is built to be valid); every other role gets 403.
 * Later phases add rows to ENDPOINTS.
 */

type Method = 'get' | 'post' | 'patch' | 'delete';

interface Ctx {
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

interface Row {
  method: Method;
  path: (c: Ctx) => string;
  body?: (c: Ctx) => object;
  roles: readonly Role[];
  status: number;
}

const ALL = ROLE_VALUES;
const ADMIN: readonly Role[] = ['admin'];

const ENDPOINTS: Row[] = [
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

let n = 0;

async function buildContext(role: Role): Promise<Ctx> {
  n += 1;
  const me = await loginAs(role);
  const second = await api()
    .post('/api/v1/auth/login')
    .send({ email: me.user.email, password: TEST_PASSWORD });
  const target = await createUser('labtech');
  const inactive = await createUser('labtech', { isActive: false });
  return {
    me,
    targetId: target._id.toString(),
    inactiveId: inactive._id.toString(),
    otherSessionId: verifyAccessToken(second.body.data.accessToken).sid,
    n,
  };
}

const send = (row: Row, c: Ctx | null) => {
  const ctx =
    c ??
    ({
      targetId: '0'.repeat(24),
      inactiveId: '0'.repeat(24),
      otherSessionId: '0'.repeat(24),
      n: 0,
    } as Ctx);
  let req = api()[row.method](`/api/v1${row.path(ctx)}`);
  if (c) req = req.set(c.me.auth);
  if (row.body) req = req.send(row.body(ctx));
  return req;
};

describe('RBAC matrix (Phase 1 endpoints)', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await resetDb();
    emails = captureEmails(); // welcome and reset emails are sent in the background
  });
  afterAll(() => emails.restore());

  for (const row of ENDPOINTS) {
    for (const role of ALL) {
      const allowed = row.roles.includes(role);
      const expected = allowed ? row.status : 403;
      const label = `${row.method.toUpperCase()} ${row.path({ targetId: ':id', inactiveId: ':id', otherSessionId: ':id' } as Ctx)}`;
      it(`${label} as ${role} → ${expected}`, async () => {
        const res = await send(row, await buildContext(role));
        expect(res.status, JSON.stringify(res.body)).toBe(expected);
      });
    }
  }

  it('every protected endpoint returns 401 without a token', async () => {
    for (const row of ENDPOINTS) {
      const res = await send(row, null);
      expect(res.status, `${row.method} ${row.path({} as Ctx)}`).toBe(401);
    }
  });
});
