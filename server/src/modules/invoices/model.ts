import { randomUUID } from 'node:crypto';
import mongoose, {
  Schema,
  type ClientSession,
  type InferSchemaType,
  type UpdateQuery,
} from 'mongoose';
import {
  BILLING_RULES,
  ERROR_CODES,
  INVOICE_KINDS,
  INVOICE_LINE_KINDS,
  INVOICE_LINE_ORIGINS,
  INVOICE_STATUSES,
} from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { touchedFields } from '../../utils/updateFields.js';

const { ObjectId } = Schema.Types;
const text = (max: number) => ({ type: String, trim: true, maxlength: max });
const wholePaise = {
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isSafeInteger, message: 'Must be a whole number of paise' },
};

/**
 * One invoice line (spec §6.21). Name and price are snapshots, so later catalogue changes never
 * alter an invoice. `taxPaise` and `lineTotalPaise` are always computed on the server (calc.ts).
 * Lab test lines keep the lab order and item they bill, so a cancelled test finds its line.
 */
const lineSchema = new Schema({
  kind: { type: String, enum: INVOICE_LINE_KINDS, required: true },
  origin: { type: String, enum: INVOICE_LINE_ORIGINS, required: true, default: 'staff' },
  /** The service (consultation, procedure) or lab test billed. */
  refId: { type: ObjectId },
  labOrder: { type: ObjectId, ref: 'LabOrder' },
  labOrderItem: { type: ObjectId },
  description: { ...text(BILLING_RULES.descriptionMax), required: true },
  quantity: { type: Number, required: true, min: 1, max: BILLING_RULES.maxQuantity },
  unitPricePaise: wholePaise,
  discountPaise: { ...wholePaise, default: 0 },
  taxRateBps: { type: Number, required: true, min: 0, max: BILLING_RULES.maxTaxRateBps },
  taxPaise: wholePaise,
  lineTotalPaise: wholePaise,
});

const statusEntrySchema = new Schema(
  {
    status: { type: String, enum: INVOICE_STATUSES, required: true },
    at: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User' },
    note: text(BILLING_RULES.reasonMaxLength),
  },
  { _id: false },
);

/**
 * A lab test cancelled after its invoice was issued: the line stays (issued invoices are locked)
 * and reception sees it here to refund it.
 */
const cancelledItemSchema = new Schema(
  {
    lineId: { type: ObjectId },
    description: { type: String, required: true },
    lineTotalPaise: { type: Number, required: true },
    labOrderId: { type: ObjectId, ref: 'LabOrder', required: true },
    itemId: { type: ObjectId, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Invoice (spec §6.21). Drafts are created by signing a note (the appointment's invoice), by
 * lab tests ordered after the invoice was issued (a supplementary draft), or by reception
 * (manual). The number is assigned on issue. After issue the lines, totals and identity are
 * locked: only status bookkeeping changes, and the paid amounts only through the payment
 * service (`paymentWriteOptions()`). Never deleted.
 */
const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, trim: true },
    kind: { type: String, enum: INVOICE_KINDS, required: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    appointment: { type: ObjectId, ref: 'Appointment', immutable: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'draft', required: true },
    items: { type: [lineSchema], default: [] },
    subtotalPaise: { ...wholePaise, default: 0 },
    discountTotalPaise: { ...wholePaise, default: 0 },
    taxTotalPaise: { ...wholePaise, default: 0 },
    totalPaise: { ...wholePaise, default: 0 },
    amountPaidPaise: { ...wholePaise, default: 0 },
    balancePaise: { ...wholePaise, default: 0 },
    currency: { type: String, default: 'INR' },
    issuedAt: Date,
    issuedBy: { type: ObjectId, ref: 'User' },
    /** Calendar date (UTC midnight), like other date-only fields. */
    dueDate: Date,
    void: {
      by: { type: ObjectId, ref: 'User' },
      at: Date,
      reason: text(BILLING_RULES.reasonMaxLength),
    },
    notes: text(BILLING_RULES.notesMax),
    /** Set when an admin saved a discount above `maxDiscountPercentWithoutAdmin` (§4.9). */
    discountApproval: {
      by: { type: ObjectId, ref: 'User' },
      at: Date,
    },
    cancelledItemsBilled: { type: [cancelledItemSchema], default: [] },
    statusHistory: { type: [statusEntrySchema], default: [] },
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true, collection: 'invoices' },
);

invoiceSchema.index({ patient: 1, createdAt: -1 });
invoiceSchema.index({ patient: 1, issuedAt: -1, _id: -1 }); // patient timeline (Phase 8)
invoiceSchema.index({ appointment: 1 });
invoiceSchema.index({ status: 1, issuedAt: -1 });
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });
// At most one draft per appointment: signing and later lab orders always find the same one.
invoiceSchema.index(
  { appointment: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'draft', appointment: { $exists: true } },
  },
);

// ---- Immutability after issue ----------------------------------------------------------------

/** Fields that may change once an invoice is issued (status bookkeeping). */
const MUTABLE_AFTER_ISSUE = new Set([
  'status',
  'statusHistory',
  'void',
  'cancelledItemsBilled',
  'updatedBy',
  'updatedAt',
  '__v',
]);
/** Fields only the payment service may change after issue (with its token). */
const PAYMENT_FIELDS = new Set(['amountPaidPaise', 'balancePaise']);

/**
 * A random per-process token: only code holding `paymentWriteOptions()` (payments and refunds)
 * can change the paid amounts of an issued invoice. A string, not a symbol: Mongoose copies
 * options.
 */
const PAYMENT_TOKEN = randomUUID();

/** Query options that let the payment service update an issued invoice's paid amounts. */
export function paymentWriteOptions(session?: ClientSession) {
  return { session, invoicePayment: PAYMENT_TOKEN };
}

/** Marks a loaded document so `save()` may change the paid amounts (payment service only). */
export function allowPaymentSave(doc: { $locals: Record<string, unknown> }) {
  doc.$locals.invoicePayment = PAYMENT_TOKEN;
}

export const invoiceLocked = () =>
  new ApiError(
    409,
    'This invoice has been issued and cannot be changed. Void it or refund instead.',
    ERROR_CODES.RECORD_LOCKED,
  );

const setsStatusTo = (update: UpdateQuery<unknown>, status: string) =>
  (update.$set as Record<string, unknown> | undefined)?.status === status ||
  (update as Record<string, unknown>).status === status;

const allowedAfterIssue = (fields: string[], paymentToken: boolean) =>
  fields.every((f) => MUTABLE_AFTER_ISSUE.has(f) || (paymentToken && PAYMENT_FIELDS.has(f)));

/** Refuses the write if it matches an issued invoice; otherwise limits it to drafts. */
async function refuseOnIssued(this: mongoose.Query<unknown, unknown>) {
  const session = (this.getOptions() as { session?: never }).session ?? null;
  const issued = await this.model
    .exists({ $and: [this.getFilter(), { status: { $ne: 'draft' } }] })
    .session(session);
  if (issued) throw invoiceLocked();
  this.where({ status: 'draft' });
}

invoiceSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], async function lockIssued() {
  const update = (this.getUpdate() ?? {}) as UpdateQuery<unknown>;
  const token = (this.getOptions() as { invoicePayment?: string }).invoicePayment === PAYMENT_TOKEN;
  // Bookkeeping (and, for the payment service, paid amounts) on any status – never back to draft.
  if (allowedAfterIssue(touchedFields(update), token) && !setsStatusTo(update, 'draft')) return;
  await refuseOnIssued.call(this);
});

invoiceSchema.pre(['replaceOne', 'findOneAndReplace'], async function lockReplace() {
  await refuseOnIssued.call(this);
});

invoiceSchema.post('init', function rememberStatus() {
  this.$locals.loadedStatus = this.status;
});

invoiceSchema.pre('save', function lockIssuedDocument() {
  if (this.isNew || this.$locals.loadedStatus === 'draft') return;
  const changed = this.modifiedPaths({ includeChildren: false }).map((p) => p.split('.')[0]!);
  const token = this.$locals.invoicePayment === PAYMENT_TOKEN;
  if (!allowedAfterIssue(changed, token) || this.status === 'draft') throw invoiceLocked();
});

const deleteRefused = () => {
  throw new ApiError(409, 'Invoices cannot be deleted', ERROR_CODES.RECORD_LOCKED);
};
invoiceSchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
invoiceSchema.pre('deleteOne', { document: true, query: true }, deleteRefused);
invoiceSchema.pre('bulkWrite', () => {
  throw new ApiError(409, 'Invoices cannot be bulk-written', ERROR_CODES.RECORD_LOCKED);
});

export type InvoiceDoc = InferSchemaType<typeof invoiceSchema>;
export type InvoiceLine = InvoiceDoc['items'][number];

const createModel = () => mongoose.model('Invoice', invoiceSchema);
export type InvoiceModel = ReturnType<typeof createModel>;

export const Invoice: InvoiceModel =
  (mongoose.models.Invoice as InvoiceModel | undefined) ?? createModel();
