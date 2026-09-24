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
      q: z.string().trim().min(1).max(100).optional(),
      needsReview: booleanQuery,
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema.body>;
export type UpdateLabOrderInput = z.infer<typeof updateLabOrderSchema.body>;
export type ListLabOrdersQuery = z.infer<typeof listLabOrdersSchema.query>;
