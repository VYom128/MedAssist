import { z } from 'zod';
import {
  LAB_ORDER_RULES,
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  type LabOrderStatus,
} from '../../config/constants.js';
import {
  booleanQuery,
  dateOnly,
  idParams,
  objectId,
  optionalText,
  paginationQuery,
} from '../../utils/zod.js';

const testIds = z
  .array(objectId)
  .min(1, 'Choose at least one test')
  .max(LAB_ORDER_RULES.maxTests, `At most ${LAB_ORDER_RULES.maxTests} tests`)
  .refine((ids) => new Set(ids).size === ids.length, 'Each test can be ordered only once');

const clinicalNotes = optionalText(LAB_ORDER_RULES.clinicalNotesMax);

/** POST /lab-orders (spec §7.14). */
export const createLabOrderSchema = {
  body: z.strictObject({
    encounterId: objectId,
    testIds,
    priority: z.enum(LAB_PRIORITIES).default('routine'),
    clinicalNotes,
  }),
};

/** PATCH /lab-orders/:id – drafts only; `testIds`, when sent, replaces the tests. */
export const updateLabOrderSchema = {
  params: idParams,
  body: z
    .strictObject({
      testIds: testIds.optional(),
      priority: z.enum(LAB_PRIORITIES).optional(),
      clinicalNotes,
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export const reason = z
  .string()
  .trim()
  .min(LAB_ORDER_RULES.reasonMinLength, `At least ${LAB_ORDER_RULES.reasonMinLength} characters`)
  .max(LAB_ORDER_RULES.reasonMaxLength, `At most ${LAB_ORDER_RULES.reasonMaxLength} characters`);

export const labOrderIdSchema = { params: idParams };

/** POST /lab-orders/:id/cancel. */
export const cancelLabOrderSchema = { params: idParams, body: z.strictObject({ reason }) };

export const itemParams = z.object({ id: objectId, itemId: objectId });

/** POST /lab-orders/:id/items/:itemId/cancel. */
export const cancelItemSchema = { params: itemParams, body: z.strictObject({ reason }) };

/** `?status=ordered,sample_collected` – one or more statuses. */
const statusList = z
  .string()
  .trim()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(LAB_ORDER_STATUSES)).min(1).max(LAB_ORDER_STATUSES.length))
  .transform((v) => [...new Set(v)] as LabOrderStatus[]);

/**
 * GET /lab-orders. Receptionists must name a patient or an appointment. `q` (lab technicians):
 * an order number, a sample id, or a patient's MRN / name. `needsReview` (doctors): their own
 * orders with results not yet acknowledged.
 */
export const listLabOrdersSchema = {
  query: z
    .object({
      ...paginationQuery,
      status: statusList.optional(),
      priority: z.enum(LAB_PRIORITIES).optional(),
      patient: objectId.optional(),
      appointment: objectId.optional(),
      encounter: objectId.optional(),
      /** Clinic dates the order was placed (inclusive). */
      from: dateOnly.optional(),
      to: dateOnly.optional(),
      /** Clinic date the order was released (the worklist's "Released today"). */
      releasedOn: dateOnly.optional(),
      q: z.string().trim().min(1).max(100).optional(),
      needsReview: booleanQuery,
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

/** POST /lab-orders/:id/reject-sample and /send-back. */
export const labOrderReasonSchema = cancelLabOrderSchema;

/**
 * One entered value. Unknown keys (e.g. a client-computed `flag`) are stripped: the server
 * computes flags. `null` or '' = no value yet (a partial save).
 */
const resultEntry = z.object({
  parameterKey: z.string().trim().min(1).max(30),
  value: z.union([z.number(), z.string().max(LAB_ORDER_RULES.textValueMax * 2), z.null()]),
});
const results = z.array(resultEntry).max(50, 'At most 50 results');
const remarks = optionalText(LAB_ORDER_RULES.remarksMax);

/** PUT /lab-orders/:id/items/:itemId/results (spec §7.14). */
export const putResultsSchema = {
  params: itemParams,
  body: z.strictObject({ results, remarks }),
};

/** POST /lab-orders/:id/items/:itemId/revise – after release, with a reason. */
export const reviseItemSchema = {
  params: itemParams,
  body: z.strictObject({
    results,
    remarks,
    reason: z
      .string()
      .trim()
      .min(
        LAB_ORDER_RULES.revisionReasonMinLength,
        `At least ${LAB_ORDER_RULES.revisionReasonMinLength} characters`,
      )
      .max(
        LAB_ORDER_RULES.reasonMaxLength,
        `At most ${LAB_ORDER_RULES.reasonMaxLength} characters`,
      ),
  }),
};

/** POST /lab-orders/:id/items/:itemId/verify-revision. */
export const itemIdSchema = { params: itemParams };

export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema.body>;
export type UpdateLabOrderInput = z.infer<typeof updateLabOrderSchema.body>;
export type ListLabOrdersQuery = z.infer<typeof listLabOrdersSchema.query>;
export type PutResultsInput = z.infer<typeof putResultsSchema.body>;
export type ReviseItemInput = z.infer<typeof reviseItemSchema.body>;
