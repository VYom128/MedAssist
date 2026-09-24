import mongoose, { Schema, type InferSchemaType, type UpdateQuery } from 'mongoose';
import {
  DRUG_FORMS,
  DRUG_FREQUENCY_CODES,
  DRUG_ROUTES,
  DRUG_TIMINGS,
  ERROR_CODES,
  PRESCRIPTION_RULES,
  PRESCRIPTION_STATUSES,
} from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';

const { ObjectId } = Schema.Types;
const { textLimits: LIMITS } = PRESCRIPTION_RULES;
const text = (max: number) => ({ type: String, trim: true, maxlength: max });

/**
 * An allergy match on an item (spec §8.6) and the doctor's acknowledgement. Stored with the item
 * so the issued prescription records who accepted which warning, and when.
 */
const allergyWarningSchema = new Schema(
  {
    substance: { type: String, required: true, trim: true, maxlength: 100 },
    matchedOn: { type: String, enum: ['drug', 'class'], required: true },
    drugClass: { type: String, trim: true, maxlength: 60 },
    acknowledgedBy: { type: ObjectId, ref: 'User' },
    acknowledgedAt: Date,
  },
  { _id: false },
);

/**
 * A prescription item (spec §6.16). Drafts may hold incomplete items (autosave); issuing checks
 * that every item has a dose, a frequency (or text for 'other') and a duration.
 */
const itemSchema = new Schema(
  {
    drugName: { ...text(LIMITS.drugName), required: true },
    genericName: text(LIMITS.genericName),
    strength: text(LIMITS.strength),
    form: { type: String, enum: DRUG_FORMS },
    dose: text(LIMITS.dose),
    route: { type: String, enum: DRUG_ROUTES },
    frequency: { type: String, enum: DRUG_FREQUENCY_CODES },
    frequencyText: text(LIMITS.frequencyText),
    timing: { type: String, enum: DRUG_TIMINGS },
    durationDays: { type: Number, min: 1, max: PRESCRIPTION_RULES.maxDurationDays },
    quantity: text(LIMITS.quantity),
    instructions: text(LIMITS.instructions),
    allergyWarning: allergyWarningSchema,
  },
  { _id: false },
);

const cancellationSchema = new Schema(
  {
    by: { type: ObjectId, ref: 'User' },
    at: Date,
    reason: text(PRESCRIPTION_RULES.reasonMaxLength),
  },
  { _id: false },
);

/**
 * Prescription (spec §6.16). One CURRENT prescription per encounter (partial unique index on
 * `encounter` where `isCurrent`): a reissue cancels the current one (isCurrent false) and
 * creates a new draft with `replaces`. The number (RX-<year>-000001) is assigned on issue.
 *
 * After issue the content is locked (§10.5): only the status fields below may change
 * (completion, cancellation); every other update of a non-draft prescription throws 409
 * RECORD_LOCKED, and prescriptions are never deleted.
 */
const prescriptionSchema = new Schema(
  {
    prescriptionNumber: { type: String, trim: true },
    encounter: { type: ObjectId, ref: 'Encounter', required: true, immutable: true },
    appointment: { type: ObjectId, ref: 'Appointment', required: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    doctor: { type: ObjectId, ref: 'User', required: true, immutable: true },
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'draft', required: true },
    isCurrent: { type: Boolean, default: true },
    items: {
      type: [itemSchema],
      default: [],
      validate: {
        validator: (items: unknown[]) => items.length <= PRESCRIPTION_RULES.maxItems,
        message: `At most ${PRESCRIPTION_RULES.maxItems} items`,
      },
    },
    generalInstructions: text(LIMITS.generalInstructions),
    issuedAt: Date,
    issuedBy: { type: ObjectId, ref: 'User' },
    completedAt: Date,
    cancellation: cancellationSchema,
    replaces: { type: ObjectId, ref: 'Prescription', immutable: true },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

prescriptionSchema.index(
  { encounter: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);
prescriptionSchema.index(
  { prescriptionNumber: 1 },
  { unique: true, partialFilterExpression: { prescriptionNumber: { $type: 'string' } } },
);
prescriptionSchema.index({ patient: 1, issuedAt: -1 });
prescriptionSchema.index({ doctor: 1, status: 1, createdAt: -1 });
prescriptionSchema.index({ status: 1, issuedAt: 1 }); // completion job

// ---- Immutability after issue ----------------------------------------------------------------

/** Fields that may still change once a prescription is issued (status bookkeeping only). */
const MUTABLE_AFTER_ISSUE = new Set([
  'status',
  'isCurrent',
  'completedAt',
  'cancellation',
  'updatedBy',
  'updatedAt',
  '__v',
]);

const locked = () =>
  new ApiError(
    409,
    'This prescription has been issued and cannot be changed. Cancel it or reissue it instead.',
    ERROR_CODES.RECORD_LOCKED,
  );

/**
 * Top-level field names an update touches (`$set: { 'cancellation.at': … }` → cancellation).
 * `$setOnInsert` (added by Mongoose timestamps) only applies to inserts, so it is ignored.
 */
function touchedFields(update: UpdateQuery<unknown>): string[] {
  const fields = new Set<string>();
  for (const [key, value] of Object.entries(update)) {
    if (key === '$setOnInsert') continue;
    if (key.startsWith('$')) {
      for (const path of Object.keys((value ?? {}) as object)) fields.add(path.split('.')[0]!);
    } else {
      fields.add(key.split('.')[0]!);
    }
  }
  return [...fields];
}

const setsStatusTo = (update: UpdateQuery<unknown>, status: string) =>
  (update.$set as Record<string, unknown> | undefined)?.status === status ||
  (update as Record<string, unknown>).status === status;

prescriptionSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate'],
  async function lockIssuedContent() {
    const update = (this.getUpdate() ?? {}) as UpdateQuery<unknown>;
    const onlyStatusFields = touchedFields(update).every((f) => MUTABLE_AFTER_ISSUE.has(f));
    // Content changes (and moving back to draft) only on drafts.
    if (onlyStatusFields && !setsStatusTo(update, 'draft')) return;
    const session = (this.getOptions() as { session?: never }).session ?? null;
    const issued = await this.model
      .exists({ $and: [this.getFilter(), { status: { $ne: 'draft' } }] })
      .session(session);
    if (issued) throw locked();
    this.where({ status: 'draft' });
  },
);

prescriptionSchema.pre(['replaceOne', 'findOneAndReplace'], async function lockReplace() {
  const session = (this.getOptions() as { session?: never }).session ?? null;
  const issued = await this.model
    .exists({ $and: [this.getFilter(), { status: { $ne: 'draft' } }] })
    .session(session);
  if (issued) throw locked();
  this.where({ status: 'draft' });
});

prescriptionSchema.post('init', function rememberStatus() {
  this.$locals.loadedStatus = this.status;
});

prescriptionSchema.pre('save', function lockIssuedDocument() {
  if (this.isNew || this.$locals.loadedStatus === 'draft') return;
  const changed = this.modifiedPaths({ includeChildren: false }).map((p) => p.split('.')[0]!);
  if (changed.some((f) => !MUTABLE_AFTER_ISSUE.has(f)) || this.status === 'draft') throw locked();
});

const deleteRefused = () => {
  throw new ApiError(409, 'Prescriptions cannot be deleted', ERROR_CODES.RECORD_LOCKED);
};
prescriptionSchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
prescriptionSchema.pre('deleteOne', { document: true, query: true }, deleteRefused);
prescriptionSchema.pre('bulkWrite', () => {
  throw new ApiError(409, 'Prescriptions cannot be bulk-written', ERROR_CODES.RECORD_LOCKED);
});

export type PrescriptionDoc = InferSchemaType<typeof prescriptionSchema>;
export type PrescriptionItem = PrescriptionDoc['items'][number];

const createModel = () => mongoose.model('Prescription', prescriptionSchema);
export type PrescriptionModel = ReturnType<typeof createModel>;

export const Prescription: PrescriptionModel =
  (mongoose.models.Prescription as PrescriptionModel | undefined) ?? createModel();
