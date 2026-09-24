import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_LINK_TYPES,
  DOCUMENT_RULES,
  ERROR_CODES,
  ROLE_VALUES,
  STORAGE_DRIVERS,
  UPLOAD_MIME_TYPES,
} from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';

const { ObjectId } = Schema.Types;

/**
 * A stored file about a patient (spec §6.23): uploads and system-generated PDFs (lab reports).
 * The bytes live in the storage adapter under `storageKey` (random, `select: false`, never sent
 * to clients); downloads stream through GET /documents/:id/download. Never deleted – only
 * soft-deleted with a reason (generated documents not even that).
 */
const documentSchema = new Schema(
  {
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, required: true },
    title: { type: String, required: true, trim: true, maxlength: DOCUMENT_RULES.titleMax },
    originalName: { type: String, required: true, maxlength: DOCUMENT_RULES.originalNameMax },
    mimeType: { type: String, enum: UPLOAD_MIME_TYPES, required: true, immutable: true },
    sizeBytes: { type: Number, required: true, min: 1, immutable: true },
    storageDriver: { type: String, enum: STORAGE_DRIVERS, required: true, immutable: true },
    storageKey: { type: String, required: true, immutable: true, select: false },
    checksumSha256: { type: String, required: true, immutable: true, match: /^[0-9a-f]{64}$/ },
    linked: {
      type: { type: String, enum: DOCUMENT_LINK_TYPES },
      id: ObjectId,
    },
    visibleToPatient: { type: Boolean, default: false },
    isGenerated: { type: Boolean, default: false, immutable: true },
    uploadedBy: { type: ObjectId, ref: 'User' },
    /** The uploader's role (reception reads referrals/others only from reception or patients). */
    uploadedByRole: { type: String, enum: ROLE_VALUES },
    isDeleted: { type: Boolean, default: false },
    deletedBy: { type: ObjectId, ref: 'User' },
    deletedAt: Date,
    deleteReason: { type: String, trim: true, maxlength: DOCUMENT_RULES.deleteReasonMaxLength },
  },
  { timestamps: true, collection: 'documents' },
);

documentSchema.index({ patient: 1, isDeleted: 1, createdAt: -1 });
documentSchema.index({ 'linked.type': 1, 'linked.id': 1 });

const deleteRefused = () => {
  throw new ApiError(409, 'Documents are only soft-deleted', ERROR_CODES.RECORD_LOCKED);
};
documentSchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
documentSchema.pre('deleteOne', { document: true, query: true }, deleteRefused);
documentSchema.pre('bulkWrite', () => {
  throw new ApiError(409, 'Documents cannot be bulk-written', ERROR_CODES.RECORD_LOCKED);
});

export type DocumentDoc = InferSchemaType<typeof documentSchema>;

const createModel = () => mongoose.model('Document', documentSchema);
export type DocumentModel = ReturnType<typeof createModel>;

export const Document: DocumentModel =
  (mongoose.models.Document as DocumentModel | undefined) ?? createModel();
