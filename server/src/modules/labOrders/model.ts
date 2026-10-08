import { randomUUID } from 'node:crypto';
import mongoose, {
  Schema,
  type ClientSession,
  type InferSchemaType,
  type UpdateQuery,
} from 'mongoose';
import {
  ERROR_CODES,
  LAB_FLAGS,
  LAB_ITEM_STATUSES,
  LAB_ORDER_RULES,
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  LAB_SAMPLE_TYPES,
} from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { touchedFields } from '../../utils/updateFields.js';

const { ObjectId, Mixed } = Schema.Types;
const text = (max: number) => ({ type: String, trim: true, maxlength: max });

/** One parameter's value with the flag the server computed (spec §6.20). */
const resultSchema = new Schema(
  {
    parameterKey: { type: String, required: true },
    name: { type: String, required: true },
    unit: String,
    value: Mixed,
    referenceText: String,
    flag: { type: String, enum: LAB_FLAGS, default: 'na' },
  },
  { _id: false },
);

/** A replaced version of an item's results (revision after release). */
const previousResultSchema = new Schema(
  {
    version: { type: Number, required: true },
    results: { type: [resultSchema], default: [] },
    remarks: String,
    enteredBy: { type: ObjectId, ref: 'User' },
    verifiedBy: { type: ObjectId, ref: 'User' },
    revisedBy: { type: ObjectId, ref: 'User' },
    revisedAt: Date,
    reason: text(LAB_ORDER_RULES.reasonMaxLength),
  },
  { _id: false },
);

/**
 * A revision waiting for a second lab technician (dual verification on). The released results
 * stay what patients see until it is verified.
 */
const pendingRevisionSchema = new Schema(
  {
    results: { type: [resultSchema], default: [] },
    remarks: String,
    reason: text(LAB_ORDER_RULES.reasonMaxLength),
    by: { type: ObjectId, ref: 'User' },
    at: Date,
  },
  { _id: false },
);

const cancellationSchema = new Schema(
  {
    by: { type: ObjectId, ref: 'User' },
    at: Date,
    reason: text(LAB_ORDER_RULES.reasonMaxLength),
  },
  { _id: false },
);

/** The catalogue entry as it was when ordered (name and price may change later). */
const testSnapshotSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    pricePaise: { type: Number, required: true },
    sampleType: { type: String, enum: LAB_SAMPLE_TYPES },
    turnaroundHours: Number,
  },
  { _id: false },
);

/** One ordered test (spec §6.20). `_id` is the item id used in the item routes. */
const itemSchema = new Schema({
  test: { type: ObjectId, ref: 'LabTest', required: true },
  testSnapshot: { type: testSnapshotSchema, required: true },
  status: { type: String, enum: LAB_ITEM_STATUSES, default: 'pending', required: true },
  results: { type: [resultSchema], default: [] },
  remarks: text(LAB_ORDER_RULES.remarksMax),
  resultVersion: { type: Number, default: 1 },
  previousResults: { type: [previousResultSchema], default: [] },
  pendingRevision: pendingRevisionSchema,
  /** The result version whose critical values were already alerted (alert once per version). */
  criticalAlertedVersion: Number,
  enteredBy: { type: ObjectId, ref: 'User' },
  enteredAt: Date,
  verifiedBy: { type: ObjectId, ref: 'User' },
  verifiedAt: Date,
  cancellation: cancellationSchema,
});

const statusEntrySchema = new Schema(
  {
    status: { type: String, enum: LAB_ORDER_STATUSES, required: true },
    at: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User' },
    note: text(LAB_ORDER_RULES.reasonMaxLength),
  },
  { _id: false },
);

/**
 * Lab order (spec §6.20). Drafts belong to the ordering doctor's unsigned note and are placed
 * (status 'ordered', number LAB-<year>-000001 from the counter, `orderedAt`) when the note is
 * signed – or straight away for a signed note inside the documentation window.
 *
 * Never deleted. Once released, item results change only through the revision service
 * (`revisionWriteOptions()` / `allowRevisionSave()`); any other write touching `items` of a
 * released order throws 409 RECORD_LOCKED (spec §10.5).
 */
const labOrderSchema = new Schema(
  {
    orderNumber: { type: String, trim: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    orderedBy: { type: ObjectId, ref: 'User', required: true, immutable: true },
    encounter: { type: ObjectId, ref: 'Encounter', required: true, immutable: true },
    appointment: { type: ObjectId, ref: 'Appointment', required: true, immutable: true },
    priority: { type: String, enum: LAB_PRIORITIES, default: 'routine', required: true },
    clinicalNotes: text(LAB_ORDER_RULES.clinicalNotesMax),
    status: { type: String, enum: LAB_ORDER_STATUSES, default: 'draft', required: true },
    /** When the order was placed (left draft). Set only for placed orders. */
    orderedAt: Date,
    sample: {
      sampleId: String, // barcode value, 'S26-000001'
      // `{ type: String }`: a bare `type: String` would make `sample` itself a String path.
      type: { type: String },
      collectedBy: { type: ObjectId, ref: 'User' },
      collectedAt: Date,
      /** Age in whole years at collection: reference ranges use it (spec §8.7). */
      patientAgeYears: Number,
      rejection: { reason: String, by: { type: ObjectId, ref: 'User' }, at: Date },
    },
    items: { type: [itemSchema], default: [] },
    hasCritical: { type: Boolean, default: false },
    reportDocument: { type: ObjectId, ref: 'Document' },
    releasedAt: Date,
    releasedBy: { type: ObjectId, ref: 'User' },
    /** Set when the ordering doctor has reviewed the results ("results to review"). */
    reviewedByDoctorAt: Date,
    reviewedBy: { type: ObjectId, ref: 'User' },
    /** Set once by the TAT job when the order passed its turnaround time. */
    tatBreachedAt: Date,
    cancellation: cancellationSchema,
    statusHistory: { type: [statusEntrySchema], default: [] },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true, collection: 'lab_orders' },
);

labOrderSchema.index({ status: 1, priority: -1, createdAt: 1 }); // lab worklist
labOrderSchema.index({ patient: 1, createdAt: -1 });
// Patient timeline (Phase 8): doctors by order time, patients by release time.
labOrderSchema.index({ patient: 1, orderedAt: -1, _id: -1 });
labOrderSchema.index({ patient: 1, releasedAt: -1, _id: -1 });
labOrderSchema.index({ orderedBy: 1, status: 1 });
labOrderSchema.index({ encounter: 1 });
labOrderSchema.index({ 'sample.sampleId': 1 }, { unique: true, sparse: true });
labOrderSchema.index(
  { orderNumber: 1 },
  { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } },
);

// ---- Immutability of released results ------------------------------------------------------

/**
 * A random per-process token: only code holding `revisionWriteOptions()` (the revision service)
 * can change the items of a released order. A string, not a symbol: Mongoose copies options.
 */
const REVISION_TOKEN = randomUUID();

/** Query options that let the revision service update a released order's items. */
export function revisionWriteOptions(session?: ClientSession) {
  return { session, labRevision: REVISION_TOKEN };
}

/** Marks a loaded document so `save()` may change a released order's items (revisions only). */
export function allowRevisionSave(doc: { $locals: Record<string, unknown> }) {
  doc.$locals.labRevision = REVISION_TOKEN;
}

const resultsLocked = () =>
  new ApiError(
    409,
    'These results have been released and can only be changed by a revision',
    ERROR_CODES.RECORD_LOCKED,
  );

/** Refuses the write if it matches a released order; otherwise limits it to unreleased ones. */
async function refuseOnReleased(this: mongoose.Query<unknown, unknown>) {
  const session = (this.getOptions() as { session?: never }).session ?? null;
  const released = await this.model
    .exists({ $and: [this.getFilter(), { status: 'released' }] })
    .session(session);
  if (released) throw resultsLocked();
  this.where({ status: { $ne: 'released' } });
}

const hasToken = (q: mongoose.Query<unknown, unknown>) =>
  (q.getOptions() as { labRevision?: string }).labRevision === REVISION_TOKEN;

/** Updates touching `items` are refused on released orders (unless from the revision service). */
labOrderSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], async function lockItems() {
  if (hasToken(this)) return;
  const update = (this.getUpdate() ?? {}) as UpdateQuery<unknown>;
  if (!touchedFields(update).includes('items')) return;
  await refuseOnReleased.call(this);
});

/** Replacing a whole order would rewrite its items. */
labOrderSchema.pre(['replaceOne', 'findOneAndReplace'], async function lockReplace() {
  if (hasToken(this)) return;
  await refuseOnReleased.call(this);
});

labOrderSchema.post('init', function rememberStatus() {
  this.$locals.loadedStatus = this.status;
});

labOrderSchema.pre('save', function lockReleasedDocument() {
  if (this.isNew || this.$locals.loadedStatus !== 'released') return;
  if (this.$locals.labRevision === REVISION_TOKEN) return;
  if (this.isModified('items')) throw resultsLocked();
});

const deleteRefused = () => {
  throw new ApiError(409, 'Lab orders cannot be deleted', ERROR_CODES.RECORD_LOCKED);
};
labOrderSchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
labOrderSchema.pre('deleteOne', { document: true, query: true }, deleteRefused);
// Bulk writes would skip the checks above.
labOrderSchema.pre('bulkWrite', () => {
  throw new ApiError(409, 'Lab orders cannot be bulk-written', ERROR_CODES.RECORD_LOCKED);
});

export type LabOrderDoc = InferSchemaType<typeof labOrderSchema>;
export type LabOrderItem = LabOrderDoc['items'][number];
export type LabResult = LabOrderItem['results'][number];

const createModel = () => mongoose.model('LabOrder', labOrderSchema);
export type LabOrderModel = ReturnType<typeof createModel>;

export const LabOrder: LabOrderModel =
  (mongoose.models.LabOrder as LabOrderModel | undefined) ?? createModel();
