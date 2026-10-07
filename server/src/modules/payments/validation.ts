import { z } from 'zod';
import {
  BILLING_RULES,
  PAYMENT_METHODS,
  PAYMENT_METHODS_NEEDING_REFERENCE,
} from '../../config/constants.js';
import { booleanQuery, dateOnly, idParams, paise } from '../../utils/zod.js';

const positivePaise = paise.min(1, 'Must be more than 0');

/**
 * POST /invoices/:id/payments – card, UPI and insurance payments need a reference (slip, UPI
 * transaction id, claim number).
 */
export const recordPaymentSchema = {
  params: idParams,
  body: z
    .strictObject({
      amountPaise: positivePaise,
      method: z.enum(PAYMENT_METHODS),
      reference: z
        .string()
        .trim()
        .max(BILLING_RULES.referenceMax, `At most ${BILLING_RULES.referenceMax} characters`)
        .optional()
        .transform((v) => v || undefined),
    })
    .superRefine((b, ctx) => {
      const needs = (PAYMENT_METHODS_NEEDING_REFERENCE as readonly string[]).includes(b.method);
      if (needs && !b.reference) {
        ctx.addIssue({
          code: 'custom',
          path: ['reference'],
          message: 'Enter the reference (card slip, UPI transaction id or claim number)',
        });
      }
    }),
};
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema.body>;

/** POST /payments/:id/refund – the amount to return and why (≥ 10 characters). */
export const refundSchema = {
  params: idParams,
  body: z.strictObject({
    amountPaise: positivePaise,
    reason: z
      .string()
      .trim()
      .min(
        BILLING_RULES.refundReasonMinLength,
        `At least ${BILLING_RULES.refundReasonMinLength} characters`,
      )
      .max(BILLING_RULES.reasonMaxLength, `At most ${BILLING_RULES.reasonMaxLength} characters`),
  }),
};
export type RefundInput = z.infer<typeof refundSchema.body>;

export const paymentIdSchema = { params: idParams };

/** `?download=true` → attachment instead of inline. */
export const pdfSchema = { params: idParams, query: z.object({ download: booleanQuery }) };

/** GET /payments/summary?date=YYYY-MM-DD (default: today in the clinic). */
export const summarySchema = { query: z.object({ date: dateOnly.optional() }) };
