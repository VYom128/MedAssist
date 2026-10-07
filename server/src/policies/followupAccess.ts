import { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref?: Ref | null) => (ref ? ('_id' in ref ? ref._id : ref).toString() : null);

/** The request fields the rules look at (`patient`/`assignedDoctor` may be populated). */
export interface FollowupRefs {
  _id: Types.ObjectId;
  patient: Ref;
  assignedDoctor?: Ref | null;
}

/**
 * Who may read a follow-up request (spec §2.4 "Follow-up requests", §7.13):
 * - receptionists and admins: every request (admins read only);
 * - doctors: requests assigned to them;
 * - the patient: their own (internal staff notes removed by the serializer);
 * - lab technicians: none.
 */
export function canReadFollowup(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  r: FollowupRefs,
) {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return true;
    case ROLES.DOCTOR:
      return idOf(r.assignedDoctor) === user.id;
    case ROLES.PATIENT:
      return user.patientId !== null && idOf(r.patient) === user.patientId;
    default:
      return false;
  }
}

/**
 * Who may act on a request (reply, review, schedule, close): reception, and the assigned doctor.
 * The patient's own actions (reply, close) are checked by `canReadFollowup` plus the route.
 */
export function canHandleFollowup(user: Pick<AuthUser, 'id' | 'role'>, r: FollowupRefs) {
  if (user.role === ROLES.RECEPTIONIST) return true;
  return user.role === ROLES.DOCTOR && idOf(r.assignedDoctor) === user.id;
}

/** 404 (never 403, spec §10.2), audited as `access.denied`. */
async function deny(user: AuthUser, r: FollowupRefs, request?: RequestMeta) {
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'followup_request', id: r._id },
    patient: idOf(r.patient),
    request,
    metadata: { reason: 'followup_access' },
  });
  return ApiError.notFound('Follow-up request not found');
}

export async function assertCanReadFollowup(
  user: AuthUser,
  r: FollowupRefs,
  request?: RequestMeta,
): Promise<void> {
  if (canReadFollowup(user, r)) return;
  throw await deny(user, r, request);
}

/** Reception or the assigned doctor (patients and others → 404, like a read). */
export async function assertCanHandleFollowup(
  user: AuthUser,
  r: FollowupRefs,
  request?: RequestMeta,
): Promise<void> {
  if (canHandleFollowup(user, r)) return;
  throw await deny(user, r, request);
}

/** The requests `user` may list (GET /follow-up-requests), as a Mongo filter. */
export function followupListFilter(user: Pick<AuthUser, 'id' | 'role' | 'patientId'>) {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return {};
    case ROLES.DOCTOR:
      return { assignedDoctor: new Types.ObjectId(user.id) };
    case ROLES.PATIENT:
      return user.patientId
        ? { patient: new Types.ObjectId(user.patientId) }
        : { _id: { $in: [] } };
    default:
      return { _id: { $in: [] } };
  }
}
