import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  PATIENT_ACCESS_SCOPES,
  ROLES,
  type PatientAccessScope,
  type Role,
} from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import { FollowupRequest } from '../modules/followups/model.js';
import { LabOrder } from '../modules/labOrders/model.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import type { RequestMeta } from '../utils/requestContext.js';

type PatientId = string | Types.ObjectId;

/** Access scopes (spec §2.3): demographics | clinical | billing | lab (+ allergies, D60). */
export const SCOPES = PATIENT_ACCESS_SCOPES;

/**
 * Scopes each staff role has for any patient (spec §2.4, §2.5 and the Phase 3 decisions).
 * Admins and receptionists never get `clinical`; receptionists get `allergies` (safety
 * information for the front desk). Doctors are absent: their access depends on a care
 * relationship. Lab technicians are absent too: they see patients only through lab orders
 * (LAB_TECH_SCOPES).
 */
const ROLE_SCOPES: Partial<Record<Role, ReadonlySet<PatientAccessScope>>> = {
  [ROLES.ADMIN]: new Set(['demographics', 'billing']),
  [ROLES.RECEPTIONIST]: new Set(['demographics', 'billing', 'allergies']),
};

/**
 * What a doctor with a care relationship may access (spec §2.3, §2.5): demographics, clinical
 * records, lab results and allergies (part of the clinical picture). Not billing – doctors see
 * invoice summaries only, through their own module (Phase 7).
 */
const CARE_RELATIONSHIP_SCOPES: ReadonlySet<PatientAccessScope> = new Set([
  'demographics',
  'clinical',
  'lab',
  'allergies',
]);

/**
 * What a lab technician may access for a patient with a placed lab order (spec §2.5, D-Phase 6):
 * name, MRN, age and sex (demographics – the lab serializer shows no contact details), allergies
 * and lab data. Never through /patients: the lab module serialises what they see.
 */
const LAB_TECH_SCOPES: ReadonlySet<PatientAccessScope> = new Set([
  'demographics',
  'lab',
  'allergies',
]);

/** Lab orders that were placed (drafts – even discarded ones – were never placed). */
export const PLACED_LAB_ORDER = { orderedAt: { $type: 'date' } } as const;

// ---- Care relationship (spec §2.3) ----------------------------------------------------------

/** One way a doctor can be related to a patient. Must be read-only and never throw on "no". */
export type RelationshipCheck = (
  doctorId: Types.ObjectId,
  patientId: Types.ObjectId,
) => Promise<boolean>;

/** Appointment statuses that do not create a care relationship. */
const NO_RELATIONSHIP_STATUSES = ['cancelled'] as const;

/**
 * The doctor has an appointment with the patient that was not cancelled – past, today or
 * future, including no-shows (spec §2.3). Uses the `{ patient, startAt }` index.
 */
export async function hasAppointmentRelationship(
  doctorId: Types.ObjectId,
  patientId: Types.ObjectId,
): Promise<boolean> {
  return Boolean(
    await Appointment.exists({
      patient: patientId,
      doctor: doctorId,
      status: { $nin: NO_RELATIONSHIP_STATUSES },
    }),
  );
}

/**
 * The doctor ordered a lab test for the patient (spec §2.3): any placed order, whatever its
 * status now (a cancelled order still had a clinical reason); unplaced drafts do not count.
 */
export async function hasLabOrderRelationship(
  doctorId: Types.ObjectId,
  patientId: Types.ObjectId,
): Promise<boolean> {
  return Boolean(
    await LabOrder.exists({ patient: patientId, orderedBy: doctorId, ...PLACED_LAB_ORDER }),
  );
}

/**
 * A follow-up request from the patient is assigned to the doctor (spec §2.3, Phase 8) – in any
 * status: like a past appointment, a handled request keeps the relationship.
 */
export async function hasFollowUpAssignmentRelationship(
  doctorId: Types.ObjectId,
  patientId: Types.ObjectId,
): Promise<boolean> {
  return Boolean(await FollowupRequest.exists({ patient: patientId, assignedDoctor: doctorId }));
}

/**
 * The care relationship checks, tried in order until one says yes. Break-glass access (§2.3
 * stretch goal) is not built.
 */
export const CARE_RELATIONSHIP_CHECKS: readonly RelationshipCheck[] = [
  hasAppointmentRelationship,
  hasLabOrderRelationship,
  hasFollowUpAssignmentRelationship,
];

/**
 * Per-request cache of relationship answers. It is keyed by the `AuthUser` object, which
 * `authenticate` creates afresh for every request, so an answer never outlives its request
 * (and one request never repeats the query for the same patient). Services must pass
 * `req.user` itself, never a copy – a copy just misses the cache.
 */
const relationshipCache = new WeakMap<object, Map<string, Promise<boolean>>>();

const asObjectId = (id: PatientId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);

/** `lookup()` once per request, user and patient; a failed lookup is not remembered. */
function cached(
  user: object,
  patientId: PatientId,
  lookup: (patientId: Types.ObjectId) => Promise<boolean>,
): Promise<boolean> {
  const key = patientId.toString();
  if (!Types.ObjectId.isValid(key)) return Promise.resolve(false);
  let cache = relationshipCache.get(user);
  if (!cache) {
    cache = new Map();
    relationshipCache.set(user, cache);
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const answer = lookup(asObjectId(patientId));
  cache.set(key, answer);
  answer.catch(() => cache.delete(key));
  return answer;
}

/** Whether `doctor` has a care relationship with `patientId` (cached for the request). */
export function hasCareRelationship(
  doctor: Pick<AuthUser, 'id'>,
  patientId: PatientId,
): Promise<boolean> {
  const doctorId = new Types.ObjectId(doctor.id);
  return cached(doctor, patientId, async (id) => {
    for (const check of CARE_RELATIONSHIP_CHECKS) {
      if (await check(doctorId, id)) return true;
    }
    return false;
  });
}

/** Whether the patient has a placed lab order – a lab technician's only way in (cached). */
export function hasPlacedLabOrder(
  labTech: Pick<AuthUser, 'id'>,
  patientId: PatientId,
): Promise<boolean> {
  return cached(labTech, patientId, async (id) =>
    Boolean(await LabOrder.exists({ patient: id, ...PLACED_LAB_ORDER })),
  );
}

/**
 * The single place that decides whether `user` may access `patientId`'s data in `scope`
 * (spec §2.3). Services call this; controllers never re-implement the rules.
 *
 * - patient → only their own linked record (`user.patientId`, null while the link is pending),
 *   every scope
 * - admin → demographics and billing
 * - receptionist → demographics, billing and allergies
 * - labtech → demographics, lab and allergies of patients with a placed lab order
 * - doctor → demographics, clinical, lab and allergies while a care relationship exists
 *   (database lookups, cached per request); nothing otherwise
 */
export async function canAccessPatient(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  patientId: PatientId,
  scope: PatientAccessScope,
): Promise<boolean> {
  const id = patientId.toString();

  if (user.role === ROLES.PATIENT) return user.patientId !== null && user.patientId === id;

  if (user.role === ROLES.DOCTOR) {
    if (!CARE_RELATIONSHIP_SCOPES.has(scope)) return false;
    return hasCareRelationship(user, id);
  }

  if (user.role === ROLES.LABTECH) {
    if (!LAB_TECH_SCOPES.has(scope)) return false;
    return hasPlacedLabOrder(user, id);
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
  if (await canAccessPatient(user, patientId, scope)) return;
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: { user: user.id, role: user.role, name: `${user.firstName} ${user.lastName}` },
    patient: Types.ObjectId.isValid(patientId.toString()) ? patientId : null,
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
 * The ids of the patients a doctor has a care relationship with, for list filters. Must mirror
 * CARE_RELATIONSHIP_CHECKS.
 */
export async function relatedPatientIds(doctorId: string): Promise<Types.ObjectId[]> {
  const doctor = new Types.ObjectId(doctorId);
  const [byAppointment, byLabOrder, byFollowUp] = await Promise.all([
    Appointment.distinct('patient', { doctor, status: { $nin: NO_RELATIONSHIP_STATUSES } }),
    LabOrder.distinct('patient', { orderedBy: doctor, ...PLACED_LAB_ORDER }),
    FollowupRequest.distinct('patient', { assignedDoctor: doctor }),
  ]);
  const unique = new Map<string, Types.ObjectId>();
  for (const id of [...byAppointment, ...byLabOrder, ...byFollowUp]) unique.set(id.toString(), id);
  return [...unique.values()];
}

/**
 * The patients `user` may list (GET /patients), as a Mongo filter: `{}` for every patient, the
 * related patients for a doctor, or a filter matching none.
 */
export async function patientListFilter(
  user: Pick<AuthUser, 'id' | 'role'>,
): Promise<Record<string, unknown>> {
  if (user.role === ROLES.ADMIN || user.role === ROLES.RECEPTIONIST) return {};
  if (user.role === ROLES.DOCTOR) return { _id: { $in: await relatedPatientIds(user.id) } };
  return { _id: { $in: [] } };
}
