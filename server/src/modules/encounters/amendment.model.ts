import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ENCOUNTER_RULES } from '../../config/constants.js';
import { applyAppendOnly } from '../../utils/appendOnly.js';

const { ObjectId } = Schema.Types;

/**
 * NoteAmendment (spec §6.14): one entry per amendment of a signed note, with the reason and a
 * snapshot of the changed fields before and after. Append-only: never updated or deleted.
 * `{ encounter, version }` is unique, so two concurrent amendments cannot claim one version.
 */
const noteAmendmentSchema = new Schema(
  {
    encounter: { type: ObjectId, ref: 'Encounter', required: true },
    /** The note version this amendment created (2 for the first amendment). */
    version: { type: Number, required: true, min: 2 },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: ENCOUNTER_RULES.amendmentReasonMinLength,
      maxlength: 1000,
    },
    changedFields: { type: [String], required: true },
    before: { type: Schema.Types.Mixed, default: {} },
    after: { type: Schema.Types.Mixed, default: {} },
    amendedBy: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

noteAmendmentSchema.index({ encounter: 1, version: 1 }, { unique: true });
applyAppendOnly(noteAmendmentSchema, 'Note amendments');

export type NoteAmendmentDoc = InferSchemaType<typeof noteAmendmentSchema>;

const createModel = () => mongoose.model('NoteAmendment', noteAmendmentSchema);
export type NoteAmendmentModel = ReturnType<typeof createModel>;

export const NoteAmendment: NoteAmendmentModel =
  (mongoose.models.NoteAmendment as NoteAmendmentModel | undefined) ?? createModel();
