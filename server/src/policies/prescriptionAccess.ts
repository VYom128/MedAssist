import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';
import { canAccessPatient } from './patientAccess.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref: Ref) => ('_id' in ref ? ref._id : ref).toString();

/** Statuses patients and reception may see (spec §8.6: patients only after issue). */
export const ISSUED_STATUSES = ['issued', 'completed'] as const;

export interface PrescriptionRefs {
  _id: Types.ObjectId;
  doctor: Ref;
  patient: Ref;
  status: string;
}

/**
 * Who may read a prescription (spec §2.4, §7.12):
 * - its doctor, any status; another doctor once issued (not drafts) with a care relationship;
 * - the patient: their own, issued or completed only;
 * - receptionists: issued or completed, for printing;
 * - admins and lab technicians: never.
 */
export async function canReadPrescription(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  p: PrescriptionRefs,
): Promise<boolean> {
  const issued = (ISSUED_STATUSES as readonly string[]).includes(p.status);
  switch (user.role) {
    case ROLES.DOCTOR:
      if (idOf(p.doctor) === user.id) return true;
      return p.status !== 'draft' && canAccessPatient(user, idOf(p.patient), 'clinical');
    case ROLES.PATIENT:
      return issued && user.patientId !== null && idOf(p.patient) === user.patientId;
    case ROLES.RECEPTIONIST:
      return issued;
    default:
      return false;
  }
}

/** Only the prescribing doctor changes a prescription (spec §2.3: own appointments). */
export function canWritePrescription(user: Pick<AuthUser, 'id' | 'role'>, p: PrescriptionRefs) {
  return user.role === ROLES.DOCTOR && idOf(p.doctor) === user.id;
}

async function deny(user: AuthUser, p: PrescriptionRefs, request?: RequestMeta) {
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'prescription', id: p._id },
    patient: idOf(p.patient),
    request,
    metadata: { reason: 'prescription_access' },
  });
  return ApiError.notFound('Prescription not found');
}

/** 404 (never 403, spec §10.2) unless `user` may read the prescription; audited. */
export async function assertCanReadPrescription(
  user: AuthUser,
  p: PrescriptionRefs,
  request?: RequestMeta,
): Promise<void> {
  if (await canReadPrescription(user, p)) return;
  throw await deny(user, p, request);
}

export async function assertCanWritePrescription(
  user: AuthUser,
  p: PrescriptionRefs,
  request?: RequestMeta,
): Promise<void> {
  if (canWritePrescription(user, p)) return;
  throw await deny(user, p, request);
}
