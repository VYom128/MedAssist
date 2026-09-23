import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES, type PatientAccessScope, type Role } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import type { RequestMeta } from '../utils/requestContext.js';

type PatientId = string | Types.ObjectId;

/**
 * Scopes each staff role may use for any patient (spec §2.4). Admins and receptionists never get
 * `clinical`. Doctors are absent: their access depends on a care relationship (below).
 */
const ROLE_SCOPES: Partial<Record<Role, ReadonlySet<PatientAccessScope>>> = {
  [ROLES.ADMIN]: new Set(['demographics', 'billing']),
  [ROLES.RECEPTIONIST]: new Set(['demographics', 'billing']),
  // Minimal demographics only (name, MRN, age, sex) – enforced by the lab serializer.
  [ROLES.LABTECH]: new Set(['demographics', 'lab']),
};

/**
 * Care relationship (spec §2.3): a non-cancelled appointment, a lab order by this doctor, or an
 * assigned follow-up request.
 * TODO(Phase 4/5/6/8): query appointments, lab orders and follow-ups as those modules arrive.
 * Until then no doctor has a care relationship, so doctors are denied.
 */
async function hasCareRelationship(_doctorId: string, _patientId: string): Promise<boolean> {
  return false;
}

/**
 * The single place that decides whether `user` may access `patientId`'s data in `scope`
 * (spec §2.3). Services call this; controllers never re-implement it.
 */
export async function canAccessPatient(
  user: AuthUser,
  patientId: PatientId,
  scope: PatientAccessScope,
): Promise<boolean> {
  const id = patientId.toString();

  if (user.role === ROLES.PATIENT) return user.patientId === id;

  if (user.role === ROLES.DOCTOR) return hasCareRelationship(user.id, id);

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
  if (await canAccessPatient(user, patientId, scope)) return;
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
