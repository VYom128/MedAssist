import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  DOCUMENT_RULES,
  DOCUMENT_UPLOAD_CATEGORIES,
  RECEPTION_DOCUMENT_CATEGORIES,
  RECEPTION_SHARED_CATEGORIES,
  ROLES,
  type DocumentCategory,
  type PatientAccessScope,
  type Role,
} from '../config/constants.js';
import { LabOrder } from '../modules/labOrders/model.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';
import { canAccessPatient, PLACED_LAB_ORDER, relatedPatientIds } from './patientAccess.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref: Ref) => ('_id' in ref ? ref._id : ref).toString();

/** The document fields the rules look at. */
export interface DocumentRefs {
  _id: Types.ObjectId;
  patient: Ref;
  category: string;
  visibleToPatient?: boolean | null;
  isGenerated?: boolean | null;
  isDeleted?: boolean | null;
  uploadedBy?: Ref | null;
  uploadedByRole?: string | null;
  createdAt?: Date | null;
}

/**
 * The patient scope a role needs to upload or read a patient's documents: doctors a care
 * relationship (clinical), lab technicians a placed lab order (lab), reception any patient.
 */
export const DOCUMENT_SCOPE: Partial<Record<Role, PatientAccessScope>> = {
  [ROLES.DOCTOR]: 'clinical',
  [ROLES.LABTECH]: 'lab',
  [ROLES.RECEPTIONIST]: 'demographics',
  [ROLES.PATIENT]: 'demographics',
};

export const uploadCategoriesFor = (role: Role) => DOCUMENT_UPLOAD_CATEGORIES[role] ?? [];

/** Reception reads non-clinical documents: ID, insurance, invoices, and referrals/other files
 * that a receptionist or the patient uploaded (never a doctor's clinical upload). */
function receptionMayRead(d: DocumentRefs): boolean {
  if ((RECEPTION_DOCUMENT_CATEGORIES as readonly string[]).includes(d.category)) return true;
  return (
    (RECEPTION_SHARED_CATEGORIES as readonly string[]).includes(d.category) &&
    (d.uploadedByRole === ROLES.RECEPTIONIST || d.uploadedByRole === ROLES.PATIENT)
  );
}

/**
 * Who may open (download) a document (spec §2.4, §7.16, Phase 6 decisions):
 * - doctor: any category, for patients with a care relationship;
 * - receptionist: non-clinical documents (receptionMayRead);
 * - lab technician: lab reports of patients with a placed lab order;
 * - patient: their own documents marked visible to them;
 * - admin: metadata only (canSeeMetadata), never the file.
 * Soft-deleted documents: nobody.
 */
export async function canReadDocument(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  d: DocumentRefs,
): Promise<boolean> {
  if (d.isDeleted) return false;
  const patient = idOf(d.patient);
  switch (user.role) {
    case ROLES.DOCTOR:
      return canAccessPatient(user, patient, 'clinical');
    case ROLES.RECEPTIONIST:
      return receptionMayRead(d);
    case ROLES.LABTECH:
      return d.category === 'lab_report' && canAccessPatient(user, patient, 'lab');
    case ROLES.PATIENT:
      return Boolean(d.visibleToPatient) && user.patientId === patient;
    default:
      return false;
  }
}

/** Metadata (GET /documents/:id): readers, plus admins (spec §2.4 "R metadata"). */
export async function canSeeMetadata(user: AuthUser, d: DocumentRefs): Promise<boolean> {
  if (user.role === ROLES.ADMIN) return !d.isDeleted;
  return canReadDocument(user, d);
}

/**
 * Soft delete (spec §7.16): admins, or the uploader within 24 hours. Generated documents (lab
 * reports) never – they are part of released results.
 */
export function canDeleteDocument(
  user: Pick<AuthUser, 'id' | 'role'>,
  d: DocumentRefs,
  now = new Date(),
) {
  if (d.isDeleted || d.isGenerated) return false;
  if (user.role === ROLES.ADMIN) return true;
  const own = d.uploadedBy ? idOf(d.uploadedBy) === user.id : false;
  const age = now.getTime() - (d.createdAt?.getTime() ?? 0);
  return own && age <= DOCUMENT_RULES.uploaderDeleteHours * 3_600_000;
}

/** 404 (never 403, spec §10.2), audited as `access.denied`. */
export async function denyDocument(user: AuthUser, d: DocumentRefs, request?: RequestMeta) {
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'document', id: d._id },
    patient: idOf(d.patient),
    request,
    metadata: { reason: 'document_access' },
  });
  return ApiError.notFound('Document not found');
}

/**
 * The documents `user` may list, as a Mongo filter (soft-deleted ones never). `patientId`,
 * when given, has already passed the patient check.
 */
export async function documentListFilter(
  user: AuthUser,
  patientId?: string,
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = { isDeleted: false };
  const onePatient = patientId ? { patient: new Types.ObjectId(patientId) } : null;
  switch (user.role) {
    case ROLES.ADMIN:
      return { ...base, ...onePatient };
    case ROLES.DOCTOR:
      return {
        ...base,
        ...(onePatient ?? { patient: { $in: await relatedPatientIds(user.id) } }),
      };
    case ROLES.RECEPTIONIST:
      return {
        ...base,
        ...onePatient,
        $or: [
          { category: { $in: RECEPTION_DOCUMENT_CATEGORIES } },
          {
            category: { $in: RECEPTION_SHARED_CATEGORIES },
            uploadedByRole: { $in: [ROLES.RECEPTIONIST, ROLES.PATIENT] },
          },
        ],
      };
    case ROLES.LABTECH:
      return {
        ...base,
        category: 'lab_report' satisfies DocumentCategory,
        ...(onePatient ?? {
          patient: { $in: await LabOrder.distinct('patient', PLACED_LAB_ORDER) },
        }),
      };
    case ROLES.PATIENT:
      return {
        ...base,
        visibleToPatient: true,
        patient: user.patientId ? new Types.ObjectId(user.patientId) : { $in: [] },
      };
    default:
      return { _id: { $in: [] } };
  }
}
