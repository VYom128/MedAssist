import type { Types } from 'mongoose';
import type { UserDoc } from './model.js';

type UserLike = UserDoc & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

const isLocked = (u: UserLike) => Boolean(u.lockUntil && u.lockUntil.getTime() > Date.now());

/** The caller's own account (`/auth/me`, login and register responses). */
export function toSelfView(u: UserLike) {
  return {
    id: u._id.toString(),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
    emailVerifiedAt: u.emailVerifiedAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
    avatarUrl: u.avatarUrl ?? null,
    /** Linked Patient record (Phase 3). */
    patientId: u.patient?.toString() ?? null,
    /** Doctor profile (Phase 2). */
    doctorProfileId: null,
  };
}

/** Admin view for `/users` (account management fields; no secrets). */
export function toAdminView(u: UserLike) {
  return {
    id: u._id.toString(),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    isActive: u.isActive,
    isLocked: isLocked(u),
    lockUntil: isLocked(u) ? u.lockUntil : null,
    failedLoginAttempts: u.failedLoginAttempts,
    mustChangePassword: u.mustChangePassword,
    emailVerifiedAt: u.emailVerifiedAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
    patientId: u.patient?.toString() ?? null,
    patientLinkStatus: u.patientLinkStatus ?? null,
    createdAt: u.createdAt ?? null,
    updatedAt: u.updatedAt ?? null,
  };
}
