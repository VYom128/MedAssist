import { randomBytes } from 'node:crypto';
import type { FilterQuery, Types } from 'mongoose';
import { ACCOUNT_SETUP_TTL_MS, AUDIT_ACTIONS, ERROR_CODES, ROLES } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import { emailService, sendInBackground } from '../../services/email.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { hashPassword } from '../../utils/password.js';
import { containsRegex } from '../../utils/regex.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { createPasswordResetToken } from '../auth/service.js';
import * as sessions from '../sessions/service.js';
import { User, type UserDoc } from './model.js';
import { toAdminView } from './serializer.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './validation.js';

type UserWithId = UserDoc & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

async function findUser(id: string): Promise<UserWithId> {
  const user = (await User.findById(id).lean()) as UserWithId | null;
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

const invalidTransition = (message: string) =>
  new ApiError(409, message, ERROR_CODES.INVALID_STATUS_TRANSITION);

/** GET /users – filters `role`, `isActive`, `q` (name or email), newest first. */
export async function listUsers(query: ListUsersQuery, { page, limit, skip }: Pagination) {
  const filter: FilterQuery<UserDoc> = {};
  if (query.role) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.q) {
    const re = containsRegex(query.q);
    filter.$or = [{ firstName: re }, { lastName: re }, { email: re }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort(query.sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return { items: items.map((u) => toAdminView(u)), meta: buildMeta({ page, limit, total }) };
}

export async function getUser(id: string) {
  return toAdminView(await findUser(id));
}

/**
 * Creates a staff account with a random temporary password that nobody sees, and
 * `mustChangePassword: true`. The welcome email carries a "set your password" link (reset-token
 * flow, valid 72 h), so no password is ever emailed or logged.
 */
export async function createUser(admin: AuthUser, input: CreateUserInput, meta: RequestMeta) {
  if (await User.exists({ email: input.email })) {
    throw ApiError.conflict('An account with this email already exists', { fields: ['email'] });
  }
  const created = await User.create({
    ...input,
    passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
    mustChangePassword: true,
    createdBy: admin.id,
    updatedBy: admin.id,
  });
  const token = await createPasswordResetToken(created._id, ACCOUNT_SETUP_TTL_MS);
  sendInBackground(
    () => emailService.sendAccountSetup(created.email, created.firstName, token),
    'account_setup',
  );
  await audit.record({
    action: AUDIT_ACTIONS.USER_CREATE,
    actor: actorOf(admin),
    resource: { type: 'user', id: created._id },
    request: meta,
    metadata: { role: created.role },
  });
  return toAdminView(created.toObject() as UserWithId);
}

/** PATCH /users/:id – name, phone, email. Changing the email clears `emailVerifiedAt`. */
export async function updateUser(
  admin: AuthUser,
  id: string,
  input: UpdateUserInput,
  meta: RequestMeta,
) {
  const before = await findUser(id);
  const changes = audit.diffChanges(before, { ...before, ...input }, Object.keys(input));
  if (changes.fields.length === 0) return toAdminView(before);

  if (input.email && input.email !== before.email && (await User.exists({ email: input.email }))) {
    throw ApiError.conflict('An account with this email already exists', { fields: ['email'] });
  }
  const emailChanged = changes.fields.includes('email');
  const updated = (await User.findByIdAndUpdate(
    id,
    {
      $set: { ...input, updatedBy: admin.id },
      ...(emailChanged ? { $unset: { emailVerifiedAt: 1 } } : {}),
    },
    { new: true, runValidators: true },
  ).lean()) as UserWithId;

  await audit.record({
    action: AUDIT_ACTIONS.USER_UPDATE,
    actor: actorOf(admin),
    resource: { type: 'user', id },
    request: meta,
    changes,
  });
  return toAdminView(updated);
}

/**
 * Deactivates a user and revokes their sessions. An admin cannot deactivate themselves or the
 * last active admin. The last-admin check runs after the write and is undone if it fails, so two
 * admins deactivating each other at once cannot leave the clinic without one.
 */
export async function deactivateUser(admin: AuthUser, id: string, meta: RequestMeta) {
  if (id === admin.id) throw ApiError.unprocessable('You cannot deactivate your own account');
  const user = await findUser(id);
  if (!user.isActive) throw invalidTransition('User is already inactive');

  const updated = (await User.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false, updatedBy: admin.id } },
    { new: true },
  ).lean()) as UserWithId | null;
  if (!updated) throw invalidTransition('User is already inactive');

  if (user.role === ROLES.ADMIN) {
    const activeAdmins = await User.countDocuments({ role: ROLES.ADMIN, isActive: true });
    if (activeAdmins === 0) {
      await User.updateOne({ _id: id }, { $set: { isActive: true } });
      throw ApiError.unprocessable('You cannot deactivate the last active admin');
    }
  }

  const revoked = await sessions.revokeAllForUser(id, 'deactivated');
  await audit.record({
    action: AUDIT_ACTIONS.USER_DEACTIVATE,
    actor: actorOf(admin),
    resource: { type: 'user', id },
    request: meta,
    changes: audit.diffChanges({ isActive: true }, { isActive: false }, ['isActive']),
    metadata: { sessionsRevoked: revoked },
  });
  return toAdminView(updated);
}

export async function activateUser(admin: AuthUser, id: string, meta: RequestMeta) {
  const updated = (await User.findOneAndUpdate(
    { _id: id, isActive: false },
    { $set: { isActive: true, updatedBy: admin.id } },
    { new: true },
  ).lean()) as UserWithId | null;
  if (!updated) {
    await findUser(id); // 404 if missing
    throw invalidTransition('User is already active');
  }
  await audit.record({
    action: AUDIT_ACTIONS.USER_ACTIVATE,
    actor: actorOf(admin),
    resource: { type: 'user', id },
    request: meta,
    changes: audit.diffChanges({ isActive: false }, { isActive: true }, ['isActive']),
  });
  return toAdminView(updated);
}

/** Emails the user a password reset link (valid 30 min). */
export async function sendPasswordReset(admin: AuthUser, id: string, meta: RequestMeta) {
  const user = await findUser(id);
  if (!user.isActive)
    throw ApiError.unprocessable('Activate the account before resetting its password');
  const token = await createPasswordResetToken(user._id);
  sendInBackground(() => emailService.sendPasswordReset(user.email, token), 'password_reset');
  await audit.record({
    action: AUDIT_ACTIONS.USER_RESET_PASSWORD,
    actor: actorOf(admin),
    resource: { type: 'user', id },
    request: meta,
  });
}

/** Clears a login lockout. */
export async function unlockUser(admin: AuthUser, id: string, meta: RequestMeta) {
  await findUser(id);
  const updated = (await User.findByIdAndUpdate(
    id,
    {
      $set: { failedLoginAttempts: 0, updatedBy: admin.id },
      $unset: { lockUntil: 1, lastFailedLoginAt: 1 },
    },
    { new: true },
  ).lean()) as UserWithId;
  await audit.record({
    action: AUDIT_ACTIONS.USER_UNLOCK,
    actor: actorOf(admin),
    resource: { type: 'user', id },
    request: meta,
  });
  return toAdminView(updated);
}
