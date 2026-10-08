import mongoose, { Schema, type InferSchemaType, type UpdateQuery } from 'mongoose';
import { AI_RULES, CLINICAL_SUMMARY_STATUSES, ERROR_CODES } from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { touchedFields } from '../../utils/updateFields.js';

const { ObjectId } = Schema.Types;

const lines = { type: [String], default: [] };

/** The validated AI output after the server checks (spec §9.2). Never changed afterwards. */
const aiDraftSchema = new Schema(
  {
    oneLineSummary: String,
    presentingComplaint: String,
    keyFindings: lines,
    vitalsHighlights: lines,
    assessment: String,
    plan: lines,
    medications: lines,
    investigations: lines,
    followUp: String,
    flagsForClinician: lines,
  },
  { _id: false },
);

/**
 * AI clinical summary of one encounter (spec §6.15, §9.2, Phase 9). Generated as a `draft` (on a
 * draft or signed note) that the note's doctor edits (`finalText`) and approves or rejects.
 * Approval needs the signed note at the version – and content, `inputHash` – the summary was
 * generated from. One `approved` summary per encounter: approving a newer one marks the older
 * `superseded`; generating a new draft supersedes the previous draft. Only approved summaries
 * with `shareWithPatient` reach the patient.
 *
 * Once out of draft the content is locked: only status bookkeeping changes (approved →
 * superseded). Summaries are never deleted.
 */
const clinicalSummarySchema = new Schema(
  {
    encounter: { type: ObjectId, ref: 'Encounter', required: true, immutable: true },
    /** encounter.version when generated (spec §6.15). */
    encounterVersion: { type: Number, required: true, immutable: true },
    /** SHA-256 of the de-identified input: catches note changes that keep the version. */
    inputHash: { type: String, required: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    doctor: { type: ObjectId, ref: 'User', required: true, immutable: true },
    status: { type: String, enum: CLINICAL_SUMMARY_STATUSES, required: true },
    aiDraft: aiDraftSchema,
    finalText: { type: String, trim: true, maxlength: AI_RULES.finalTextMax },
    editedByDoctor: { type: Boolean, default: false },
    shareWithPatient: { type: Boolean, default: false },
    /** What the server checks removed or noticed (flags only, never content). */
    serverFlags: { type: [String], default: [] },
    promptVersion: { type: String, trim: true },
    /** The model that wrote the draft, and whether it was a fallback model. */
    model: { type: String, trim: true },
    isFallbackModel: { type: Boolean, default: false },
    aiInteraction: { type: ObjectId, ref: 'AiInteraction' },
    callId: { type: String, trim: true },
    /** Why generation failed: AI_UNAVAILABLE / AI_OUTPUT_INVALID. */
    errorCode: { type: String, trim: true },
    generatedBy: { type: ObjectId, ref: 'User', required: true, immutable: true },
    generatedAt: Date,
    reviewedBy: { type: ObjectId, ref: 'User' },
    reviewedAt: Date,
    rejectionReason: { type: String, trim: true, maxlength: AI_RULES.rejectionReasonMax },
    supersededAt: Date,
  },
  { timestamps: true, collection: 'clinical_summaries' },
);

clinicalSummarySchema.index({ encounter: 1, status: 1 });
clinicalSummarySchema.index(
  { encounter: 1 },
  { unique: true, partialFilterExpression: { status: 'approved' }, name: 'one_approved' },
);
clinicalSummarySchema.index(
  { encounter: 1 },
  { unique: true, partialFilterExpression: { status: 'generating' }, name: 'one_generating' },
);
clinicalSummarySchema.index({ patient: 1, reviewedAt: -1, _id: -1 }); // timeline (approved)

// ---- Locked after review ---------------------------------------------------------------------

const EDITABLE = ['generating', 'draft'];
/** Fields that may change after review (status bookkeeping only). */
const MUTABLE_AFTER_REVIEW = new Set(['status', 'supersededAt', 'updatedAt', '__v']);

const locked = () =>
  new ApiError(
    409,
    'This summary has been reviewed and can no longer be changed',
    ERROR_CODES.RECORD_LOCKED,
  );

clinicalSummarySchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate'],
  async function lockReviewed() {
    const update = (this.getUpdate() ?? {}) as UpdateQuery<unknown>;
    if (touchedFields(update).every((f) => MUTABLE_AFTER_REVIEW.has(f))) return;
    const session = (this.getOptions() as { session?: never }).session ?? null;
    const reviewed = await this.model
      .exists({ $and: [this.getFilter(), { status: { $nin: EDITABLE } }] })
      .session(session);
    if (reviewed) throw locked();
    this.where({ status: { $in: EDITABLE } });
  },
);

clinicalSummarySchema.pre(['replaceOne', 'findOneAndReplace'], () => {
  throw locked();
});

clinicalSummarySchema.post('init', function rememberStatus() {
  this.$locals.loadedStatus = this.status;
});

clinicalSummarySchema.pre('save', function lockReviewedDocument() {
  if (this.isNew || EDITABLE.includes(this.$locals.loadedStatus as string)) return;
  const changed = this.modifiedPaths({ includeChildren: false }).map((p) => p.split('.')[0]!);
  if (changed.some((f) => !MUTABLE_AFTER_REVIEW.has(f))) throw locked();
});

const deleteRefused = () => {
  throw new ApiError(409, 'Clinical summaries cannot be deleted', ERROR_CODES.RECORD_LOCKED);
};
clinicalSummarySchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
clinicalSummarySchema.pre('deleteOne', { document: true, query: true }, deleteRefused);
clinicalSummarySchema.pre('bulkWrite', () => {
  throw new ApiError(409, 'Clinical summaries cannot be bulk-written', ERROR_CODES.RECORD_LOCKED);
});

export type ClinicalSummaryDoc = InferSchemaType<typeof clinicalSummarySchema>;

const createModel = () => mongoose.model('ClinicalSummary', clinicalSummarySchema);
export type ClinicalSummaryModel = ReturnType<typeof createModel>;

export const ClinicalSummary: ClinicalSummaryModel =
  (mongoose.models.ClinicalSummary as ClinicalSummaryModel | undefined) ?? createModel();
