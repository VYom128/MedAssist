import type { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  LOCKOUT,
  PASSWORD_RESET,
  ROLES,
  type Role,
} from '../../config/constants.js';
import { config } from '../../config/env.js';
import * as audit from '../../services/audit.service.js';
import { emailService, sendInBackground } from '../../services/email.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { fakePasswordCheck, hashPassword, verifyPassword } from '../../utils/password.js';
import type { AuditActor, RequestMeta } from '../../utils/requestContext.js';
import { randomToken, sha256, signAccessToken } from '../../utils/tokens.js';
import * as sessions from '../sessions/service.js';
import { toSessionView } from '../sessions/serializer.js';
import { User, type UserDoc } from '../users/model.js';
import { toSelfView } from '../users/serializer.js';
import type { RegisterInput, UpdateMeInput } from './validation.js';

type UserWithId = UserDoc & { _id: Types.ObjectId };

const invalidCredentials = () =>
  new ApiError(401, 'Invalid email or password', ERROR_CODES.INVALID_CREDENTIALS);
const accountLocked = () =>
  new ApiError(
    423,
    'Too many failed attempts. Try again in 15 minutes or reset your password.',
    ERROR_CODES.ACCOUNT_LOCKED,
  );
const accountInactive = () =>
  new ApiError(403, 'This account has been deactivated', ERROR_CODES.ACCOUNT_INACTIVE);
const sessionRevoked = () =>
  new ApiError(401, 'Your session has ended. Please log in again.', ERROR_CODES.SESSION_REVOKED);

const actorOf = (u: { _id: Types.ObjectId; role: string; firstName: string; lastName: string }) =>
  ({ user: u._id.toString(), role: u.role, name: `${u.firstName} ${u.lastName}` }) as AuditActor;

const clientOf = (meta: RequestMeta) => ({ userAgent: meta.userAgent, ip: meta.ip });

/** What login, register and refresh return. `refreshToken` goes into the cookie, never the body. */
export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: ReturnType<typeof toSelfView>;
  refreshToken: string | null;
}

function issueAccessToken(user: UserWithId, sessionId: string) {
  return {
    accessToken: signAccessToken({
      sub: user._id.toString(),
      role: user.role as Role,
      sid: sessionId,
    }),
    expiresIn: config.auth.accessExpiresIn,
  };
}

async function startSession(user: UserWithId, meta: RequestMeta): Promise<AuthResult> {
  const { sessionId, refreshToken } = await sessions.createSession(user._id, clientOf(meta));
  return { ...issueAccessToken(user, sessionId), user: toSelfView(user), refreshToken };
}

/**
 * Patient self-signup (spec §4.4, Phase 1 scope): creates a `patient` user only and logs them in.
 * The Patient record and linking arrive in Phase 3.
 */
export async function register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  if (await User.exists({ email: input.email })) {
    throw ApiError.conflict('An account with this email already exists', { fields: ['email'] });
  }
  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    role: ROLES.PATIENT,
    lastLoginAt: new Date(),
  });
  const plain = user.toObject() as UserWithId;
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_REGISTER,
    actor: actorOf(plain),
    resource: { type: 'user', id: plain._id },
    request: meta,
  });
  return startSession(plain, meta);
}

/**
 * Records a failed password for an existing user and locks the account after 5 failures within
 * 15 minutes (spec §5.8). One atomic pipeline update, so parallel attempts all count.
 * @returns true if this failure locked the account.
 */
async function registerFailedLogin(userId: Types.ObjectId): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOCKOUT.windowMs);
  const updated = await User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          failedLoginAttempts: {
            $cond: [
              { $gte: ['$lastFailedLoginAt', windowStart] },
              { $add: ['$failedLoginAttempts', 1] },
              1,
            ],
          },
          lastFailedLoginAt: now,
        },
      },
      {
        $set: {
          lockUntil: {
            $cond: [
              { $gte: ['$failedLoginAttempts', LOCKOUT.maxAttempts] },
              new Date(now.getTime() + LOCKOUT.lockMs),
              '$lockUntil',
            ],
          },
        },
      },
    ],
    { new: true, projection: { lockUntil: 1 } },
  ).lean();
  return Boolean(updated?.lockUntil && updated.lockUntil > now);
}

/**
 * Email + password login (spec §7.2, §10.1). Unknown emails and wrong passwords get the same
 * message and similar timing. `ACCOUNT_LOCKED` is returned while locked whatever the password;
 * `ACCOUNT_INACTIVE` only after a correct password.
 */
export async function login(
  emailAddress: string,
  password: string,
  meta: RequestMeta,
): Promise<AuthResult> {
  const user = (await User.findOne({ email: emailAddress }).select('+passwordHash').lean()) as
    (UserWithId & { passwordHash: string }) | null;

  if (!user) {
    await fakePasswordCheck(password);
    await audit.record({
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      outcome: 'failure',
      request: meta,
      metadata: { reason: 'unknown_email' },
    });
    throw invalidCredentials();
  }

  const failed = (reason: string) =>
    audit.record({
      action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
      outcome: 'failure',
      actor: actorOf(user),
      resource: { type: 'user', id: user._id },
      request: meta,
      metadata: { reason },
    });

  if (user.lockUntil && user.lockUntil > new Date()) {
    await fakePasswordCheck(password);
    await failed('locked');
    throw accountLocked();
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const nowLocked = await registerFailedLogin(user._id);
    await failed(nowLocked ? 'bad_password_locked' : 'bad_password');
    throw nowLocked ? accountLocked() : invalidCredentials();
  }

  if (!user.isActive) {
    await failed('inactive');
    throw accountInactive();
  }

  const now = new Date();
  await User.updateOne(
    { _id: user._id },
    {
      $set: { lastLoginAt: now, failedLoginAttempts: 0 },
      $unset: { lockUntil: 1, lastFailedLoginAt: 1 },
    },
  );
  const result = await startSession({ ...user, lastLoginAt: now }, meta);
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_LOGIN,
    actor: actorOf(user),
    resource: { type: 'user', id: user._id },
    request: meta,
  });
  return result;
}

/**
 * Rotates the refresh token and returns a new access token (spec §10.1). A rotated token reused
 * within 10 s gets an access token for its replacement (two tabs refreshing at once); later
 * reuse revokes the whole family and is audited as `auth.refresh_reuse`.
 */
export async function refresh(rawToken: string, meta: RequestMeta): Promise<AuthResult> {
  const result = await sessions.rotateRefreshToken(rawToken, clientOf(meta));

  if (result.kind === 'invalid') throw sessionRevoked();

  const user = (await User.findById(result.userId).lean()) as UserWithId | null;

  if (result.kind === 'reuse') {
    await audit.record({
      action: AUDIT_ACTIONS.AUTH_REFRESH_REUSE,
      outcome: 'denied',
      actor: user ? actorOf(user) : null,
      resource: { type: 'session_family', number: result.family },
      request: meta,
    });
    throw sessionRevoked();
  }

  if (!user || !user.isActive) {
    await sessions.revokeAllForUser(result.userId, 'admin');
    throw user ? accountInactive() : sessionRevoked();
  }

  return {
    ...issueAccessToken(user, result.sessionId),
    user: toSelfView(user),
    refreshToken: result.kind === 'rotated' ? result.refreshToken : null,
  };
}

/** Ends the caller's current login (its whole rotation family). */
export async function logout(authUser: AuthUser, meta: RequestMeta) {
  await sessions.revokeFamily(authUser.sessionFamily, 'logout');
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_LOGOUT,
    actor: authActor(authUser),
    resource: { type: 'session', id: authUser.sid },
    request: meta,
  });
}

/** Revokes every session of the caller, on all devices. */
export async function logoutAll(authUser: AuthUser, meta: RequestMeta) {
  const revoked = await sessions.revokeAllForUser(authUser.id, 'logout_all');
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_LOGOUT_ALL,
    actor: authActor(authUser),
    resource: { type: 'user', id: authUser.id },
    request: meta,
    metadata: { sessionsRevoked: revoked },
  });
  return { sessionsRevoked: revoked };
}

function authActor(u: AuthUser): AuditActor {
  return { user: u.id, role: u.role, name: `${u.firstName} ${u.lastName}` };
}

async function loadUser(id: string): Promise<UserWithId> {
  const user = (await User.findById(id).lean()) as UserWithId | null;
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

/** The caller's own account. */
export async function getMe(authUser: AuthUser) {
  return toSelfView(await loadUser(authUser.id));
}

/** Updates the caller's name and/or phone. Audited with field names; phone values redacted. */
export async function updateMe(authUser: AuthUser, input: UpdateMeInput, meta: RequestMeta) {
  const before = await loadUser(authUser.id);
  const fields = (Object.keys(input) as (keyof UpdateMeInput)[]).filter(
    (k) => input[k] !== before[k],
  );
  if (fields.length === 0) return toSelfView(before);

  const updated = (await User.findByIdAndUpdate(
    authUser.id,
    { $set: { ...input, updatedBy: authUser.id } },
    { new: true, runValidators: true },
  ).lean()) as UserWithId;

  await audit.record({
    action: AUDIT_ACTIONS.AUTH_PROFILE_UPDATE,
    actor: authActor(authUser),
    resource: { type: 'user', id: authUser.id },
    request: meta,
    changes: redactedChanges(fields, before, updated),
  });
  return toSelfView(updated);
}

/** Fields whose before/after values may be stored in the audit log; others are redacted. */
const AUDITABLE_VALUES = new Set(['firstName', 'lastName', 'isActive', 'role']);

/** Changed field names with before/after; values of sensitive fields become '[REDACTED]'. */
export function redactedChanges(
  fields: string[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const pick = (src: Record<string, unknown>) =>
    Object.fromEntries(fields.map((f) => [f, AUDITABLE_VALUES.has(f) ? src[f] : '[REDACTED]']));
  return { fields, before: pick(before), after: pick(after) };
}

/**
 * Changes the caller's password, clears `mustChangePassword`, revokes every other session and
 * returns a fresh access token for the current one (older tokens fail the passwordChangedAt check).
 */
export async function changePassword(
  authUser: AuthUser,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
) {
  const user = (await User.findById(authUser.id).select('+passwordHash').lean()) as
    (UserWithId & { passwordHash: string }) | null;
  if (!user) throw ApiError.notFound('User not found');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.validation('Validation failed', [
      { field: 'body.currentPassword', message: 'Current password is incorrect' },
    ]);
  }

  const now = new Date();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: now,
        mustChangePassword: false,
        updatedBy: user._id,
      },
      $unset: { passwordReset: 1 },
    },
  );
  const revoked = await sessions.revokeAllForUser(
    user._id,
    'password_changed',
    authUser.sessionFamily,
  );
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
    actor: authActor(authUser),
    resource: { type: 'user', id: user._id },
    request: meta,
    metadata: { otherSessionsRevoked: revoked },
  });
  const fresh = { ...user, mustChangePassword: false };
  return { ...issueAccessToken(fresh, authUser.sid), user: toSelfView(fresh) };
}

/**
 * Stores a hashed single-use reset token on the user and emails the link.
 * @param ttlMs 30 min for resets; 72 h for new-account setup links.
 * @returns the raw token (for the email only).
 */
export async function createPasswordResetToken(
  userId: Types.ObjectId | string,
  ttlMs: number = PASSWORD_RESET.ttlMs,
): Promise<string> {
  const token = randomToken(PASSWORD_RESET.tokenBytes);
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        passwordReset: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
      },
    },
  );
  return token;
}

/**
 * Forgot password (spec §7.2). The caller always gets the same 200 response. The email is sent
 * in the background so response time does not reveal whether the account exists.
 */
export async function forgotPassword(emailAddress: string, meta: RequestMeta): Promise<void> {
  const user = (await User.findOne({
    email: emailAddress,
    isActive: true,
  }).lean()) as UserWithId | null;
  if (!user) return;

  const token = await createPasswordResetToken(user._id);
  sendInBackground(() => emailService.sendPasswordReset(user.email, token), 'password_reset');
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUESTED,
    actor: actorOf(user),
    resource: { type: 'user', id: user._id },
    request: meta,
  });
}

/**
 * Sets a new password from a reset (or account setup) link. Single use: the token is consumed
 * atomically with the password change. Also clears any lockout and revokes all sessions.
 */
export async function resetPassword(token: string, password: string, meta: RequestMeta) {
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const user = (await User.findOneAndUpdate(
    {
      'passwordReset.tokenHash': sha256(token),
      'passwordReset.expiresAt': { $gt: now },
      isActive: true,
    },
    {
      $set: {
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        failedLoginAttempts: 0,
      },
      $unset: { passwordReset: 1, lockUntil: 1, lastFailedLoginAt: 1 },
    },
    { new: true },
  ).lean()) as UserWithId | null;

  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired');

  const revoked = await sessions.revokeAllForUser(user._id, 'password_changed');
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
    actor: actorOf(user),
    resource: { type: 'user', id: user._id },
    request: meta,
    metadata: { sessionsRevoked: revoked },
  });
}

/** The caller's active sessions. */
export async function listSessions(authUser: AuthUser) {
  const list = await sessions.listActiveSessions(authUser.id);
  return list.map((s) => toSessionView(s, authUser.sessionFamily));
}

/** Signs out one of the caller's own devices; someone else's session is a 404. */
export async function revokeOwnSession(authUser: AuthUser, sessionId: string, meta: RequestMeta) {
  const session = await sessions.findActiveSession(authUser.id, sessionId);
  if (!session) throw ApiError.notFound('Session not found');
  await sessions.revokeFamily(session.family, 'logout');
  await audit.record({
    action: AUDIT_ACTIONS.AUTH_SESSION_REVOKE,
    actor: authActor(authUser),
    resource: { type: 'session', id: session._id },
    request: meta,
  });
  return { current: session.family === authUser.sessionFamily };
}
