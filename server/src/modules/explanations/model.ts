import mongoose, { Schema, type InferSchemaType, type UpdateQuery } from 'mongoose';
import {
  AI_RULES,
  ERROR_CODES,
  EXPLANATION_LANGUAGES,
  EXPLANATION_OUTCOMES,
  EXPLANATION_SOURCE_TYPES,
} from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { touchedFields } from '../../utils/updateFields.js';

const { ObjectId } = Schema.Types;

const medicineSchema = new Schema(
  {
    name: String,
    whatToDo: String,
    whenToTake: String,
    howLong: String,
    tips: { type: [String], default: [] },
  },
  { _id: false },
);

const contentSchema = new Schema(
  {
    overview: String,
    medicines: { type: [medicineSchema], default: [] },
    followUp: String,
    questionsToAskDoctor: { type: [String], default: [] },
    /** From the fixed clinic list (data/safetyNet.ts), never from the model. */
    whenToContactClinic: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * A patient explanation (spec §6.17, §9.3, Phase 9): every explanation produced is kept (the AI
 * monitor reads them). `cached` ones are the patient's cache – one per (source, version,
 * language), partial unique index – and carry the patient's feedback. Doctor previews
 * (`preview`) and templates made because the AI was unavailable are not cached. The content is
 * never changed afterwards; only `feedback` may be set.
 */
const patientExplanationSchema = new Schema(
  {
    sourceType: { type: String, enum: EXPLANATION_SOURCE_TYPES, required: true, immutable: true },
    sourceId: { type: ObjectId, required: true, immutable: true },
    /** Prescription: its reissue generation (1, 2…); follow-up plan: the note version. */
    sourceVersion: { type: Number, required: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    language: { type: String, enum: EXPLANATION_LANGUAGES, required: true, immutable: true },
    content: { type: contentSchema, required: true },
    /** Added by the server (data/safetyNet.ts), never generated. */
    disclaimer: { type: String, required: true },
    guardrailFlags: { type: [String], default: [] },
    /** The deterministic template instead of the model's text. */
    isFallback: { type: Boolean, default: false },
    outcome: { type: String, enum: EXPLANATION_OUTCOMES, required: true },
    cached: { type: Boolean, default: false, immutable: true },
    preview: { type: Boolean, default: false, immutable: true },
    requestedBy: { type: ObjectId, ref: 'User', required: true, immutable: true },
    promptVersion: { type: String, trim: true },
    model: { type: String, trim: true },
    aiInteraction: { type: ObjectId, ref: 'AiInteraction' },
    callId: { type: String, trim: true },
    feedback: {
      helpful: Boolean,
      comment: { type: String, trim: true, maxlength: AI_RULES.feedbackCommentMax },
      at: Date,
      by: { type: ObjectId, ref: 'User' },
    },
  },
  { timestamps: true, collection: 'patient_explanations' },
);

patientExplanationSchema.index(
  { sourceType: 1, sourceId: 1, sourceVersion: 1, language: 1 },
  { unique: true, partialFilterExpression: { cached: true }, name: 'one_cached' },
);
patientExplanationSchema.index({ patient: 1, createdAt: -1 });
patientExplanationSchema.index({ createdAt: -1 }); // AI monitor
patientExplanationSchema.index({ 'feedback.at': -1 }, { sparse: true }); // AI monitor

// ---- Content locked: only feedback may change ------------------------------------------------

const MUTABLE = new Set(['feedback', 'updatedAt', '__v']);
const locked = () => new ApiError(409, 'Explanations cannot be changed', ERROR_CODES.RECORD_LOCKED);

patientExplanationSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function lock() {
  const update = (this.getUpdate() ?? {}) as UpdateQuery<unknown>;
  if (!touchedFields(update).every((f) => MUTABLE.has(f))) throw locked();
});
patientExplanationSchema.pre(
  ['replaceOne', 'findOneAndReplace', 'deleteMany', 'findOneAndDelete'],
  () => {
    throw locked();
  },
);
patientExplanationSchema.pre('deleteOne', { document: true, query: true }, () => {
  throw locked();
});
patientExplanationSchema.pre('save', function lockSaved() {
  if (this.isNew) return;
  const changed = this.modifiedPaths({ includeChildren: false }).map((p) => p.split('.')[0]!);
  if (changed.some((f) => !MUTABLE.has(f))) throw locked();
});

export type PatientExplanationDoc = InferSchemaType<typeof patientExplanationSchema>;

const createModel = () => mongoose.model('PatientExplanation', patientExplanationSchema);
export type PatientExplanationModel = ReturnType<typeof createModel>;

export const PatientExplanation: PatientExplanationModel =
  (mongoose.models.PatientExplanation as PatientExplanationModel | undefined) ?? createModel();
