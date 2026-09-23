import mongoose from 'mongoose';
import type { Response } from 'supertest';
import { CSRF_HEADER, REFRESH_COOKIE, type Role } from '../../src/config/constants.js';
import { AuditLog } from '../../src/modules/audit/model.js';
import { clearSettingsCache } from '../../src/modules/settings/service.js';
import { User } from '../../src/modules/users/model.js';
import { flushAudit, resetAuditChainCache } from '../../src/services/audit.service.js';
import { hashPassword } from '../../src/utils/password.js';
import { api } from './testApp.js';

export const TEST_PASSWORD = 'Clinic2026!pass';

let counter = 0;

/** Inserts a user with TEST_PASSWORD (or `password`). */
export async function createUser(
  role: Role,
  overrides: Record<string, unknown> & { password?: string } = {},
) {
  counter += 1;
  const { password = TEST_PASSWORD, ...rest } = overrides;
  return User.create({
    firstName: `${role[0]?.toUpperCase()}${role.slice(1)}`,
    lastName: `Tester${counter}`,
    email: `${role}${counter}@test.medassist.dev`,
    phone: `+9198765${String(counter).padStart(5, '0')}`,
    passwordHash: await hashPassword(password),
    role,
    ...rest,
  });
}

/** `ma_rt` cookie value from a response, if it set one. */
export function refreshCookieFrom(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith(`${REFRESH_COOKIE.name}=`));
  const value = cookie?.split(';')[0]?.slice(REFRESH_COOKIE.name.length + 1);
  return value || undefined;
}

export interface LoggedIn {
  user: Awaited<ReturnType<typeof createUser>>;
  token: string;
  refreshToken: string;
  auth: { Authorization: string };
}

/** Creates a user of `role` (or uses `user`) and logs in through the API. */
export async function loginAs(
  role: Role,
  overrides: Parameters<typeof createUser>[1] = {},
): Promise<LoggedIn> {
  const user = await createUser(role, overrides);
  const res = await api()
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: overrides.password ?? TEST_PASSWORD });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.data.accessToken as string;
  return {
    user,
    token,
    refreshToken: refreshCookieFrom(res) ?? '',
    auth: { Authorization: `Bearer ${token}` },
  };
}

/** POST /auth/refresh with a refresh token cookie and the CSRF header. */
export function refreshWith(refreshToken: string) {
  return api()
    .post('/api/v1/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE.name}=${refreshToken}`)
    .set(CSRF_HEADER.name, CSRF_HEADER.value);
}

/**
 * Empties every collection through the raw driver (Mongoose blocks audit deletes by design) and
 * forgets the cached audit chain head and clinic settings.
 */
export async function resetDb() {
  await flushAudit();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  resetAuditChainCache();
  clearSettingsCache();
}

/** Audit entries for an action, oldest first (after queued writes finish). */
export async function auditEntries(action: string) {
  await flushAudit();
  return AuditLog.find({ action }).sort({ seq: 1 }).lean();
}
