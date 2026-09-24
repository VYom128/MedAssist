import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';

/**
 * Who may change a doctor's profile, weekly schedule and leave (spec §2.4, §7.6): admins for any
 * doctor, a doctor only for themselves. `doctorId` is the doctor's User id.
 */
export function canManageDoctor(user: AuthUser, doctorId: string): boolean {
  return user.role === ROLES.ADMIN || (user.role === ROLES.DOCTOR && user.id === doctorId);
}

/** Who may read a doctor's schedule and leave: admins, receptionists and the doctor themselves. */
export function canViewDoctorSchedule(user: AuthUser, doctorId: string): boolean {
  return user.role === ROLES.RECEPTIONIST || canManageDoctor(user, doctorId);
}

/**
 * Throws 403 FORBIDDEN (audited as `access.denied`) unless `allowed`. Doctors are public, so a
 * 403 hides nothing a 404 would.
 */
async function assertAllowed(
  allowed: boolean,
  user: AuthUser,
  doctorId: string,
  meta: RequestMeta,
  message: string,
) {
  if (allowed) return;
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    request: meta,
    resource: { type: 'doctor', id: doctorId },
    metadata: { reason: 'not_own_doctor' },
  });
  throw ApiError.forbidden(message);
}

export function assertCanManageDoctor(user: AuthUser, doctorId: string, meta: RequestMeta) {
  return assertAllowed(
    canManageDoctor(user, doctorId),
    user,
    doctorId,
    meta,
    'You can only change your own profile, schedule and leave',
  );
}

export function assertCanViewDoctorSchedule(user: AuthUser, doctorId: string, meta: RequestMeta) {
  return assertAllowed(
    canViewDoctorSchedule(user, doctorId),
    user,
    doctorId,
    meta,
    'You can only see your own schedule and leave',
  );
}

/** A doctor's queue (spec §7.9): admins, receptionists and the doctor themselves. */
export function assertCanViewDoctorQueue(user: AuthUser, doctorId: string, meta: RequestMeta) {
  return assertAllowed(
    canViewDoctorSchedule(user, doctorId),
    user,
    doctorId,
    meta,
    'You can only see your own queue',
  );
}
