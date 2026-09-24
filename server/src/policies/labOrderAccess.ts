import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';
import { canAccessPatient } from './patientAccess.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref: Ref) => ('_id' in ref ? ref._id : ref).toString();

/** The lab order fields the rules look at (`orderedBy`/`patient` may be populated). */
export interface LabOrderRefs {
  _id: Types.ObjectId;
  orderNumber?: string | null;
  orderedBy: Ref;
  patient: Ref;
  status: string;
  orderedAt?: Date | null;
}

/** Placed = left draft (a discarded draft was never placed). */
export const isPlaced = (o: Pick<LabOrderRefs, 'orderedAt'>) => Boolean(o.orderedAt);

export const isOrderingDoctor = (user: Pick<AuthUser, 'id' | 'role'>, o: LabOrderRefs) =>
  user.role === ROLES.DOCTOR && idOf(o.orderedBy) === user.id;

/**
 * Who may read a lab order (spec §2.4, §7.14, Phase 6 decisions):
 * - the ordering doctor, any status (drafts are private to them); another doctor once placed,
 *   with a care relationship with the patient;
 * - lab technicians and receptionists: placed orders (receptionists get a status-only view);
 * - the patient: their own, released only;
 * - admins: never (counts come with the Phase 10 reports).
 */
export async function canReadLabOrder(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  o: LabOrderRefs,
): Promise<boolean> {
  switch (user.role) {
    case ROLES.DOCTOR:
      if (isOrderingDoctor(user, o)) return true;
      return isPlaced(o) && canAccessPatient(user, idOf(o.patient), 'lab');
    case ROLES.LABTECH:
    case ROLES.RECEPTIONIST:
      return isPlaced(o);
    case ROLES.PATIENT:
      return (
        o.status === 'released' && user.patientId !== null && idOf(o.patient) === user.patientId
      );
    default:
      return false;
  }
}

async function deny(user: AuthUser, o: LabOrderRefs, request?: RequestMeta) {
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'lab_order', id: o._id },
    patient: idOf(o.patient),
    request,
    metadata: { reason: 'lab_order_access' },
  });
  // 404, never 403: the order's existence is not revealed (spec §10.2).
  return ApiError.notFound('Lab order not found');
}

/** 404 unless `user` may read the order; the denial is audited. */
export async function assertCanReadLabOrder(
  user: AuthUser,
  o: LabOrderRefs,
  request?: RequestMeta,
): Promise<void> {
  if (await canReadLabOrder(user, o)) return;
  throw await deny(user, o, request);
}

/** 404 unless `user` is the ordering doctor (draft changes, cancelling the order). */
export async function assertOrderingDoctor(
  user: AuthUser,
  o: LabOrderRefs,
  request?: RequestMeta,
): Promise<void> {
  if (isOrderingDoctor(user, o)) return;
  throw await deny(user, o, request);
}

/** 404 unless `user` is a lab technician who may see the order (placed) – lab work. */
export async function assertLabTechOn(
  user: AuthUser,
  o: LabOrderRefs,
  request?: RequestMeta,
): Promise<void> {
  if (user.role === ROLES.LABTECH && isPlaced(o)) return;
  throw await deny(user, o, request);
}

/** Item cancellation: the ordering doctor, or a lab technician on a placed order. */
export async function assertCanCancelItem(
  user: AuthUser,
  o: LabOrderRefs,
  request?: RequestMeta,
): Promise<void> {
  if (isOrderingDoctor(user, o)) return;
  await assertLabTechOn(user, o, request);
}
