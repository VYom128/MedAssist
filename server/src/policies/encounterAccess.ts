import { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';
import { canAccessPatient, relatedPatientIds } from './patientAccess.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref: Ref) => ('_id' in ref ? ref._id : ref).toString();

/** The encounter fields the rules look at (`doctor`/`patient` may be populated). */
export interface EncounterRefs {
  _id: Types.ObjectId;
  doctor: Ref;
  patient: Ref;
  status: string;
}

/**
 * Who may read a clinical note (spec §2.3, §2.4): its own doctor, always; another doctor only
 * once it is signed (drafts are private to their author) and only with a care relationship with
 * the patient. Nobody else in Phase 5 (patients read their signed notes from Phase 8; admins and
 * receptionists never).
 */
export async function canReadEncounter(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  e: EncounterRefs,
): Promise<boolean> {
  if (user.role !== ROLES.DOCTOR) return false;
  if (idOf(e.doctor) === user.id) return true;
  if (e.status === 'draft') return false;
  return canAccessPatient(user, idOf(e.patient), 'clinical');
}

/** Only the note's own doctor writes it (spec §2.3: own appointments). */
export function canWriteEncounter(user: Pick<AuthUser, 'id' | 'role'>, e: EncounterRefs): boolean {
  return user.role === ROLES.DOCTOR && idOf(e.doctor) === user.id;
}

async function deny(user: AuthUser, e: EncounterRefs, request: RequestMeta | undefined) {
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'encounter', id: e._id },
    patient: idOf(e.patient),
    request,
    metadata: { reason: 'encounter_access' },
  });
  // 404, never 403: the note's existence is not revealed (spec §10.2).
  return ApiError.notFound('Clinical note not found');
}

export async function assertCanReadEncounter(
  user: AuthUser,
  e: EncounterRefs,
  request?: RequestMeta,
): Promise<void> {
  if (await canReadEncounter(user, e)) return;
  throw await deny(user, e, request);
}

export async function assertCanWriteEncounter(
  user: AuthUser,
  e: EncounterRefs,
  request?: RequestMeta,
): Promise<void> {
  if (canWriteEncounter(user, e)) return;
  throw await deny(user, e, request);
}

/**
 * Mongo filter for the notes a doctor may list: their own (any status) and signed notes of
 * patients they have a care relationship with. `patientId` narrows it to one patient (the
 * caller checks the relationship first).
 */
export async function encounterListFilter(
  user: Pick<AuthUser, 'id' | 'role'>,
  patientId?: string,
): Promise<Record<string, unknown>> {
  if (user.role !== ROLES.DOCTOR) return { _id: { $in: [] } };
  const me = new Types.ObjectId(user.id);
  const signed = { status: { $ne: 'draft' } };
  if (patientId) {
    return { patient: new Types.ObjectId(patientId), $or: [{ doctor: me }, signed] };
  }
  const related = await relatedPatientIds(user.id);
  return { $or: [{ doctor: me }, { ...signed, patient: { $in: related } }] };
}
