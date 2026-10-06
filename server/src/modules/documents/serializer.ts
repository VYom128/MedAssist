import type { Types } from 'mongoose';
import type { DocumentDoc } from './model.js';

/**
 * Document views (spec §6.23). `storageKey` is never part of any view. Admins get metadata only
 * (no title or file name – they may describe clinical content).
 */

interface PersonDoc {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
}

export type DocumentLike = Omit<DocumentDoc, 'uploadedBy' | 'storageKey'> & {
  _id: Types.ObjectId;
  uploadedBy?: PersonDoc | Types.ObjectId | null;
  createdAt?: Date;
};

export const DOCUMENT_POPULATE = [{ path: 'uploadedBy', select: 'firstName lastName' }] as const;

const person = (ref: DocumentLike['uploadedBy']) => {
  if (!ref) return null;
  if ('firstName' in ref)
    return { id: ref._id.toString(), name: `${ref.firstName} ${ref.lastName}` };
  return { id: ref.toString(), name: null };
};

function metadata(d: DocumentLike, canDelete: boolean) {
  return {
    id: d._id.toString(),
    patientId: d.patient.toString(),
    category: d.category,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    visibleToPatient: d.visibleToPatient ?? false,
    isGenerated: d.isGenerated ?? false,
    uploadedAt: d.createdAt ?? null,
    canDelete,
  };
}

/** Everyone who may open the file. */
export function toView(d: DocumentLike, { canDelete = false }: { canDelete?: boolean } = {}) {
  return {
    ...metadata(d, canDelete),
    title: d.title,
    originalName: d.originalName,
    checksumSha256: d.checksumSha256,
    linked: d.linked?.type ? { type: d.linked.type, id: d.linked.id?.toString() ?? null } : null,
    uploadedBy: person(d.uploadedBy),
    uploadedByRole: d.uploadedByRole ?? null,
  };
}

/** Admin: metadata only. */
export function toAdminView(d: DocumentLike, { canDelete = false }: { canDelete?: boolean } = {}) {
  return metadata(d, canDelete);
}
