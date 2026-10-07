import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { BILLING_RULES, PAYMENT_KINDS, PAYMENT_METHODS } from '../../config/constants.js';
import { applyAppendOnly } from '../../utils/appendOnly.js';

const { ObjectId } = Schema.Types;

/**
 * A payment or refund (spec §6.22). Refunds are negative amounts linked to the payment they
 * return (`refundOf`) and carry a reason. Append-only (spec §10.5): never updated or deleted – a
 * mistake is corrected with a refund. Numbers 'PAY-<clinic year>-000001' are shared by payments
 * and refunds.
 */
const paymentSchema = new Schema(
  {
    paymentNumber: { type: String, required: true, trim: true },
    invoice: { type: ObjectId, ref: 'Invoice', required: true },
    patient: { type: ObjectId, ref: 'Patient', required: true },
    /** Positive for payments, negative for refunds; never 0. */
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (v: number) => Number.isSafeInteger(v) && v !== 0,
        message: 'Must be a whole, non-zero number of paise',
      },
    },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true, maxlength: BILLING_RULES.referenceMax },
    kind: { type: String, enum: PAYMENT_KINDS, required: true },
    refundOf: { type: ObjectId, ref: 'Payment' },
    reason: { type: String, trim: true, maxlength: BILLING_RULES.reasonMaxLength },
    receivedBy: { type: ObjectId, ref: 'User', required: true },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'payments' },
);

paymentSchema.index({ paymentNumber: 1 }, { unique: true });
paymentSchema.index({ invoice: 1, receivedAt: 1 });
paymentSchema.index({ receivedAt: 1 }); // day summary
paymentSchema.index({ patient: 1, receivedAt: -1, _id: -1 }); // patient timeline (Phase 8)
paymentSchema.index({ refundOf: 1 }, { sparse: true });

paymentSchema.pre('validate', function kindMatchesAmount() {
  if (this.kind === 'refund' && (this.amountPaise >= 0 || !this.refundOf || !this.reason)) {
    this.invalidate('amountPaise', 'A refund is negative, linked to a payment and has a reason');
  }
  if (this.kind === 'payment' && (this.amountPaise <= 0 || this.refundOf)) {
    this.invalidate('amountPaise', 'A payment is positive and not linked to another payment');
  }
});

applyAppendOnly(paymentSchema, 'Payments');

export type PaymentDoc = InferSchemaType<typeof paymentSchema>;

const createModel = () => mongoose.model('Payment', paymentSchema);
export type PaymentModel = ReturnType<typeof createModel>;

export const Payment: PaymentModel =
  (mongoose.models.Payment as PaymentModel | undefined) ?? createModel();
