import type { Readable } from 'node:stream';
import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  ROLES,
  type DocumentCategory,
  type DocumentLinkType,
  type UploadMimeType,
} from '../../config/constants.js';
import {
  canDeleteDocument,
  canReadDocument,
  canSeeMetadata,
  denyDocument,
  DOCUMENT_SCOPE,
  documentListFilter,
  uploadCategoriesFor,
} from '../../policies/documentAccess.js';
import { assertCanAccessPatient, PLACED_LAB_ORDER } from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import { getStorage } from '../../services/storage/index.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { detectUploadType, safeFileName, sha256 } from '../../utils/files.js';
import { logger, serializeError } from '../../utils/logger.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { Appointment } from '../appointments/model.js';
import { Encounter } from '../encounters/model.js';
import { LabOrder } from '../labOrders/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { Document } from './model.js';
import { DOCUMENT_POPULATE, toAdminView, toView, type DocumentLike } from './serializer.js';
import type { ListDocumentsQuery, UploadDocumentInput } from './validation.js';

/**
 * Documents (spec §6.23, §7.16, §10.3, §12.2): uploads checked on their bytes, stored under a
 * random key through the storage adapter, listed and opened per policies/documentAccess, and
 * soft-deleted with a reason. Generated PDFs (lab reports) are created with
 * `createGeneratedDocument()` inside the caller's transaction.
 */

/** What multer hands over (memory storage). */
export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

export const resourceOf = (d: { _id: Types.ObjectId }) => ({ type: 'document', id: d._id });

async function loadDocument(id: string | Types.ObjectId, { withKey = false } = {}) {
  const query = Document.findById(id).populate([...DOCUMENT_POPULATE]);
  if (withKey) query.select('+storageKey');
  const d = await query.lean();
  if (!d) throw ApiError.notFound('Document not found');
  return d as unknown as DocumentLike & { storageKey?: string };
}

const viewFor = (user: AuthUser, d: DocumentLike) => {
  const canDelete = canDeleteDocument(user, d);
  return user.role === ROLES.ADMIN ? toAdminView(d, { canDelete }) : toView(d, { canDelete });
};

// ---- Upload ----------------------------------------------------------------------------------

/**
 * `linked` must be a record of the same patient (appointments, notes and placed lab orders now;
 * invoices and follow-up requests arrive in Phases 7–8). Never says whether the id exists.
 */
async function assertLinkedToPatient(type: DocumentLinkType, id: string, patientId: string) {
  const filter = { _id: new Types.ObjectId(id), patient: new Types.ObjectId(patientId) };
  let found = false;
  if (type === 'appointment') found = Boolean(await Appointment.exists(filter));
  else if (type === 'encounter') found = Boolean(await Encounter.exists(filter));
  else if (type === 'lab_order') {
    found = Boolean(await LabOrder.exists({ ...filter, ...PLACED_LAB_ORDER }));
  }
  if (!found) {
    throw ApiError.unprocessable('The linked record is not one of this patient’s records', [
      { field: 'body.linkedId', message: 'Not a record of this patient' },
    ]);
  }
}

/**
 * POST /documents – the category must be one the role may upload (403 otherwise), for a patient
 * the caller may reach (doctors: care relationship; lab techs: a placed lab order; patients:
 * themselves only – anything else 404). The type comes from the bytes (415 unless PDF/JPEG/PNG);
 * the name is sanitised; a SHA-256 checksum is stored. Audited `document.upload` (no title).
 */
export async function uploadDocument(
  user: AuthUser,
  file: UploadedFile | undefined,
  input: UploadDocumentInput,
  meta: RequestMeta,
) {
  if (!file || file.size === 0) {
    throw ApiError.validation('Choose a file to upload', [
      { field: 'file', message: 'Choose a file to upload' },
    ]);
  }
  if (!(uploadCategoriesFor(user.role) as readonly string[]).includes(input.category)) {
    throw ApiError.forbidden('You cannot upload documents of this category');
  }
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user); // 403 while pending
  await assertCanAccessPatient(user, input.patientId, DOCUMENT_SCOPE[user.role]!, meta);
  if (input.linkedType && input.linkedId) {
    await assertLinkedToPatient(input.linkedType, input.linkedId, input.patientId);
  }
  const mimeType = await detectUploadType(file.buffer);
  const storage = getStorage();
  const { storageKey } = await storage.save(file.buffer, {
    mimeType,
    originalName: file.originalname,
  });

  let created;
  try {
    created = await Document.create({
      patient: input.patientId,
      category: input.category,
      title: input.title,
      originalName: safeFileName(file.originalname, mimeType),
      mimeType,
      sizeBytes: file.size,
      storageDriver: storage.driver,
      storageKey,
      checksumSha256: sha256(file.buffer),
      ...(input.linkedType ? { linked: { type: input.linkedType, id: input.linkedId } } : {}),
      visibleToPatient: user.role === ROLES.PATIENT ? true : (input.visibleToPatient ?? false),
      uploadedBy: user.id,
      uploadedByRole: user.role,
    });
  } catch (err) {
    await storage.remove(storageKey).catch(() => undefined);
    throw err;
  }
  await audit.record({
    action: AUDIT_ACTIONS.DOCUMENT_UPLOAD,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: created.patient,
    request: meta,
    metadata: {
      category: created.category,
      mimeType,
      sizeBytes: file.size,
      linkedType: input.linkedType ?? null,
    },
  });
  return viewFor(user, await loadDocument(created._id));
}

/** The pieces of a generated PDF (lab report), saved by `createGeneratedDocument()`. */
export interface GeneratedFile {
  patient: Types.ObjectId;
  category: DocumentCategory;
  title: string;
  fileName: string;
  buffer: Buffer;
  storageKey: string;
  linked?: { type: DocumentLinkType; id: Types.ObjectId };
  visibleToPatient: boolean;
  createdBy: string;
}

/** Stores generated bytes (before the transaction that records them). */
export async function storeGeneratedFile(buffer: Buffer) {
  return getStorage().save(buffer, { mimeType: 'application/pdf', originalName: 'generated.pdf' });
}

/** Records a generated PDF as a Document inside the caller's transaction. */
export async function createGeneratedDocument(file: GeneratedFile, session: ClientSession) {
  const [doc] = await Document.create(
    [
      {
        patient: file.patient,
        category: file.category,
        title: file.title,
        originalName: safeFileName(file.fileName, 'application/pdf'),
        mimeType: 'application/pdf' satisfies UploadMimeType,
        sizeBytes: file.buffer.length,
        storageDriver: getStorage().driver,
        storageKey: file.storageKey,
        checksumSha256: sha256(file.buffer),
        ...(file.linked ? { linked: file.linked } : {}),
        visibleToPatient: file.visibleToPatient,
        isGenerated: true,
        uploadedBy: file.createdBy,
        uploadedByRole: null,
      },
    ],
    { session },
  );
  return doc!._id;
}

// ---- Reads -----------------------------------------------------------------------------------

/** GET /documents – scoped per role (documentListFilter); newest first. */
export async function listDocuments(
  user: AuthUser,
  query: ListDocumentsQuery,
  { page, limit, skip }: Pagination,
  meta: RequestMeta,
) {
  if (user.role === ROLES.PATIENT) {
    const own = await resolveMyPatientId(user);
    if (query.patient && query.patient !== own) {
      await assertCanAccessPatient(user, query.patient, 'demographics', meta);
    }
  } else if (query.patient && user.role !== ROLES.ADMIN) {
    await assertCanAccessPatient(user, query.patient, DOCUMENT_SCOPE[user.role]!, meta);
  }
  const and: Record<string, unknown>[] = [await documentListFilter(user, query.patient)];
  if (query.category) and.push({ category: query.category });
  if (query.linkedType) and.push({ 'linked.type': query.linkedType });
  if (query.linkedId) and.push({ 'linked.id': new Types.ObjectId(query.linkedId) });
  if (query.from || query.to) {
    const { timezone } = await getSettings();
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfClinicDay(query.from, timezone);
    if (query.to) range.$lte = endOfClinicDay(query.to, timezone);
    and.push({ createdAt: range });
  }
  const filter = { $and: and };
  const [items, total] = await Promise.all([
    Document.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate([...DOCUMENT_POPULATE])
      .lean(),
    Document.countDocuments(filter),
  ]);
  return {
    items: (items as unknown as DocumentLike[]).map((d) => viewFor(user, d)),
    meta: buildMeta({ page, limit, total }),
  };
}

/** GET /documents/:id – metadata; audited `document.view` (debounced). */
export async function getDocument(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const d = await loadDocument(id);
  if (!(await canSeeMetadata(user, d))) throw await denyDocument(user, d, meta);
  await audit.recordRead({
    action: AUDIT_ACTIONS.DOCUMENT_VIEW,
    actor: actorOf(user),
    resource: resourceOf(d),
    patient: d.patient,
    request: meta,
  });
  return viewFor(user, d);
}

export interface OpenedFile {
  stream: Readable;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

/** Opens a stored document's bytes (after the caller's checks). */
async function open(d: DocumentLike & { storageKey?: string }): Promise<OpenedFile> {
  const stream = await getStorage().createReadStream(d.storageKey!);
  return {
    stream,
    mimeType: d.mimeType,
    fileName: safeFileName(d.originalName, d.mimeType as UploadMimeType),
    sizeBytes: d.sizeBytes,
  };
}

/** Audits one download (`document.download`, every time – not debounced). */
async function auditDownload(
  user: AuthUser,
  d: DocumentLike,
  meta: RequestMeta,
  via: 'document' | 'lab_order_report',
) {
  await audit.record({
    action: AUDIT_ACTIONS.DOCUMENT_DOWNLOAD,
    actor: actorOf(user),
    resource: resourceOf(d),
    patient: d.patient,
    request: meta,
    metadata: { category: d.category, via },
  });
}

/** GET /documents/:id/download – the file itself; same readers as the metadata minus admins. */
export async function openDocument(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const d = await loadDocument(id, { withKey: true });
  if (!(await canReadDocument(user, d))) throw await denyDocument(user, d, meta);
  const file = await open(d);
  await auditDownload(user, d, meta, 'document');
  return file;
}

/**
 * A lab order's current report (GET /lab-orders/:id/report.pdf): the caller already passed the
 * lab order rules, so the document is opened without the document policy.
 */
export async function openLabReport(user: AuthUser, documentId: Types.ObjectId, meta: RequestMeta) {
  const d = await loadDocument(documentId, { withKey: true });
  if (d.isDeleted) throw ApiError.notFound('Report not found');
  const file = await open(d);
  await auditDownload(user, d, meta, 'lab_order_report');
  return file;
}

// ---- Soft delete -----------------------------------------------------------------------------

/**
 * POST /documents/:id/delete – admins, or the uploader within 24 hours; generated documents
 * never (409 RECORD_LOCKED). The file stays in storage; the record is hidden everywhere.
 */
export async function deleteDocument(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const d = await loadDocument(id);
  if (d.isDeleted) throw ApiError.notFound('Document not found');
  if (d.isGenerated) {
    throw new ApiError(
      409,
      'Generated documents (such as lab reports) cannot be deleted',
      ERROR_CODES.RECORD_LOCKED,
    );
  }
  if (!canDeleteDocument(user, d)) {
    // Uploaders past the 24 hours get a clear 403; everybody else learns nothing.
    const own = d.uploadedBy && ('_id' in d.uploadedBy ? d.uploadedBy._id : d.uploadedBy);
    if (own?.toString() === user.id) {
      throw ApiError.forbidden('Uploads can be deleted by their uploader within 24 hours only');
    }
    throw await denyDocument(user, d, meta);
  }
  const now = new Date();
  const updated = await Document.updateOne(
    { _id: d._id, isDeleted: false },
    { $set: { isDeleted: true, deletedBy: user.id, deletedAt: now, deleteReason: reason } },
  );
  if (updated.modifiedCount === 0) throw ApiError.notFound('Document not found');
  await audit.record({
    action: AUDIT_ACTIONS.DOCUMENT_DELETE,
    actor: actorOf(user),
    resource: resourceOf(d),
    patient: d.patient,
    request: meta,
    metadata: { category: d.category, reasonGiven: true },
  });
  return { id: d._id.toString(), isDeleted: true };
}

/** Logs a stored file whose record was never written (a failed transaction). */
export function logOrphanedFile(storageKey: string, context: string, err?: unknown) {
  logger.error(
    { storageKey, context, ...(err ? { err: serializeError(err) } : {}) },
    'Orphaned file: stored, but its document record was not saved',
  );
}
