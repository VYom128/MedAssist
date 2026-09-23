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
 * Scopes each staff role has for any patient (spec §2.4, §2.5 and the Phase 3 decisions).
 * Admins and receptionists never get `clinical`; receptionists get `allergies` (safety
 * information for the front desk). Doctors are absent: their access depends on a care
 * relationship. Lab technicians get nothing until Phase 6, when they see patients only through
 * lab orders.
 */
const ROLE_SCOPES: Partial<Record<Role, ReadonlySet<PatientAccessScope>>> = {
  [ROLES.ADMIN]: new Set(['demographics', 'billing']),
  [ROLES.RECEPTIONIST]: new Set(['demographics', 'billing', 'allergies']),
};

/**
 * The single place that decides whether `user` may access `patientId`'s data in `scope`
 * (spec §2.3). Services call this; controllers never re-implement the rules. Pure: no I/O.
 *
 * - patient → only their own linked record (`user.patientId`, null while the link is pending),
 *   every scope
 * - admin → demographics and billing
 * - receptionist → demographics, billing and allergies
 * - labtech → nothing yet (Phase 6: through lab orders)
 * - doctor → nothing until the care relationship exists (Phase 5)
 */
export function canAccessPatient(
  user: Pick<AuthUser, 'role' | 'patientId'>,
  patientId: PatientId,
  scope: PatientAccessScope,
): boolean {
  const id = patientId.toString();

  if (user.role === ROLES.PATIENT) return user.patientId !== null && user.patientId === id;

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

/**
 * Whether a staff role has `scope` for every patient (for actions with no patient yet, such as
 * recording allergies while registering a new patient). Patients and doctors never do.
 */
export function roleHasPatientScope(
  user: Pick<AuthUser, 'role'>,
  scope: PatientAccessScope,
): boolean {
  return ROLE_SCOPES[user.role]?.has(scope) ?? false;
}

/**
 * The patients `user` may list (GET /patients), as a Mongo filter: `{}` for every patient,
 * or a filter matching none. Doctors will get "patients with a care relationship" in Phase 5.
 */
export function patientListFilter(user: Pick<AuthUser, 'role'>): Record<string, unknown> {
  if (user.role === ROLES.ADMIN || user.role === ROLES.RECEPTIONIST) return {};
  // TODO(Phase 5): doctors → patients with a care relationship (spec §2.3).
  return { _id: { $in: [] } };
}
