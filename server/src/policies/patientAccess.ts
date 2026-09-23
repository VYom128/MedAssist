import type { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  PATIENT_ACCESS_SCOPES,
  ROLES,
  type PatientAccessScope,
  type Role,
} from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import type { RequestMeta } from '../utils/requestContext.js';

type PatientId = string | Types.ObjectId;

/** Access scopes (spec §2.3): demographics | clinical | billing | lab. */
export const SCOPES = PATIENT_ACCESS_SCOPES;

/**
 * Scopes each staff role has for any patient (spec §2.4). Admins and receptionists never get
 * `clinical`. Doctors are absent: their access depends on a care relationship.
 */
const ROLE_SCOPES: Partial<Record<Role, ReadonlySet<PatientAccessScope>>> = {
  [ROLES.ADMIN]: new Set(['demographics', 'billing']),
  [ROLES.RECEPTIONIST]: new Set(['demographics', 'billing']),
  // Minimal demographics only (name, MRN, age, sex) – enforced by the lab serializer.
  [ROLES.LABTECH]: new Set(['demographics', 'lab']),
};

/**
 * The single place that decides whether `user` may access `patientId`'s data in `scope`
 * (spec §2.3). Services call this; controllers never re-implement the rules. Pure: no I/O.
 *
 * - patient → only their own record (`user.patientId`), every scope
 * - admin, receptionist → demographics and billing
 * - labtech → demographics and lab
 * - doctor → false for now
 */
export function canAccessPatient(
  user: Pick<AuthUser, 'role' | 'patientId'>,
  patientId: PatientId,
  scope: PatientAccessScope,
): boolean {
  const id = patientId.toString();

  if (user.role === ROLES.PATIENT) return user.patientId === id;

  if (user.role === ROLES.DOCTOR) {
    // TODO(Phase 5): care relationship (spec §2.3) – a non-cancelled appointment with the
    // patient, a lab order by this doctor, or an assigned follow-up request. That needs database
    // lookups, so this function will become async (or take the relationship as an argument).
    return false;
  }

  return ROLE_SCOPES[user.role]?.has(scope) ?? false;
}

/**
 * Throws 404 NOT_FOUND (never 403, so existence is not revealed – spec §10.2) when access is
 * denied, and audits the denial as `access.denied` with the patient set.
 */
export async function assertCanAccessPatient(
  user: AuthUser,
  patientId: PatientId,
  scope: PatientAccessScope,
  request?: RequestMeta,
): Promise<void> {
  if (canAccessPatient(user, patientId, scope)) return;
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: { user: user.id, role: user.role, name: `${user.firstName} ${user.lastName}` },
    patient: patientId,
    request,
    metadata: { reason: 'patient_access', scope },
  });
  throw ApiError.notFound('Patient not found');
}
