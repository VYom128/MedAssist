import { z } from 'zod';
import {
  BILLING_RULES,
  INVOICE_STATUSES,
  INVOICE_STAFF_LINE_KINDS,
  type InvoiceStatus,
} from '../../config/constants.js';
import {
  dateOnly,
  idParams,
  objectId,
  optionalText,
  paginationQuery,
  paise,
} from '../../utils/zod.js';

/**
 * A line as sent by the desk. Amounts the server computes (tax, totals) are not part of the
 * schema: `z.object` strips them, so client totals are ignored (spec §6.21).
 * - an existing line: `id` + the fields to change (visit lines: only `discountPaise`);
 * - a new consultation/procedure line: `kind` + `serviceId` (name, price and tax from the
 *   service), optional quantity/discount;
 * - a new 'other' line: `kind`, `description`, `unitPricePaise`, optional quantity, discount and
 *   tax rate (default: the clinic's).
 */
const lineInput = z.object({
  id: objectId.optional(),
  kind: z.enum(INVOICE_STAFF_LINE_KINDS).optional(),
  serviceId: objectId.optional(),
  description: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(BILLING_RULES.descriptionMax, `At most ${BILLING_RULES.descriptionMax} characters`)
    .optional(),
  quantity: z
    .number()
    .int('Must be a whole number')
    .min(1, 'At least 1')
    .max(BILLING_RULES.maxQuantity, `At most ${BILLING_RULES.maxQuantity}`)
    .optional(),
  unitPricePaise: paise.optional(),
  discountPaise: paise.optional(),
  taxRateBps: z
    .number()
    .int('Must be whole basis points')
    .min(0, 'Must be 0 or more')
    .max(BILLING_RULES.maxTaxRateBps, 'At most 10000 (100%)')
    .optional(),
});
export type LineInputBody = z.infer<typeof lineInput>;

const lines = z
  .array(lineInput)
  .max(BILLING_RULES.maxLines, `At most ${BILLING_RULES.maxLines} lines`);

const notes = optionalText(BILLING_RULES.notesMax);
const dueDate = dateOnly.nullable().optional();
const expectedVersion = z.number().int().min(0);

/** POST /invoices – a manual draft (reception, admin). */
export const createInvoiceSchema = {
  body: z.object({
    patientId: objectId,
    appointmentId: objectId.optional(),
    items: lines.default([]),
    notes,
    dueDate,
  }),
};
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema.body>;

/** PATCH /invoices/:id – drafts only; `items`, when sent, is the full list of lines. */
export const updateInvoiceSchema = {
  params: idParams,
  body: z
    .object({ expectedVersion, items: lines.optional(), notes, dueDate })
    .refine((b) => Object.keys(b).length > 1, 'Nothing to update'),
};
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema.body>;

export const invoiceIdSchema = { params: idParams };

/** POST /invoices/:id/issue – issue what you see (`expectedVersion` = the revision shown). */
export const issueInvoiceSchema = {
  params: idParams,
  body: z.strictObject({ expectedVersion }),
};

const reason = z
  .string()
  .trim()
  .min(BILLING_RULES.reasonMinLength, `At least ${BILLING_RULES.reasonMinLength} characters`)
  .max(BILLING_RULES.reasonMaxLength, `At most ${BILLING_RULES.reasonMaxLength} characters`);

/** POST /invoices/:id/void. */
export const voidInvoiceSchema = { params: idParams, body: z.strictObject({ reason }) };

/** `?status=issued,partially_paid` – one or more statuses. */
const statusList = z
  .string()
  .trim()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(INVOICE_STATUSES)).min(1).max(INVOICE_STATUSES.length))
  .transform((v) => [...new Set(v)] as InvoiceStatus[]);

/**
 * GET /invoices – `q`: an invoice number (exact) or a patient's MRN, phone or name; `from`/`to`:
 * clinic dates of issue (drafts: of creation).
 */
export const listInvoicesSchema = {
  query: z
    .object({
      status: statusList.optional(),
      patient: objectId.optional(),
      appointment: objectId.optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      q: z.string().trim().max(100).optional(),
      ...paginationQuery,
    })
    .refine((v) => !v.from || !v.to || v.from <= v.to, {
      message: '`from` must be on or before `to`',
      path: ['to'],
    }),
};
export type ListInvoicesQuery = z.infer<typeof listInvoicesSchema.query>;
