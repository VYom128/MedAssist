import type { Role } from '../src/config/constants.js';
import { verifyAccessToken } from '../src/utils/tokens.js';
import { createUser, loginAs, resetDb, TEST_PASSWORD } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { ALL, ENDPOINTS, routeKey, type Ctx, type Row } from './helpers/rbacMatrix.js';
import { api } from './helpers/testApp.js';

/**
 * RBAC matrix (spec §2.4, §15.1): every row of tests/helpers/rbacMatrix.ts × every role. A role
 * in `roles` must get exactly `status`; every other role gets 403.
 */

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
      const label = routeKey(row);
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
