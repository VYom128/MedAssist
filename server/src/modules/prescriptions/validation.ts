import { z } from 'zod';
import {
  DRUG_FORMS,
  DRUG_FREQUENCY_CODES,
  DRUG_ROUTES,
  DRUG_TIMINGS,
  PRESCRIPTION_RULES,
  PRESCRIPTION_STATUSES,
} from '../../config/constants.js';
import { dateOnly, idParams, objectId, optionalText, paginationQuery } from '../../utils/zod.js';

const { textLimits: LIMITS } = PRESCRIPTION_RULES;

/**
 * One draft item (spec §6.16). Only the drug name is needed to save a draft (autosave of a
 * half-filled row); what is given is validated. Issuing (signing or POST /issue) needs a dose,
 * a frequency (text for 'other') and a duration – checked in the service with field details.
 * `acknowledgeAllergy: true` accepts the allergy warning on this item (the server records who
 * and when); `false` withdraws an earlier acknowledgement.
 */
const item = z
  .strictObject({
    drugName: z
      .string()
      .trim()
      .min(1, 'Required')
      .max(LIMITS.drugName, `At most ${LIMITS.drugName} characters`),
    genericName: optionalText(LIMITS.genericName),
    strength: optionalText(LIMITS.strength),
    form: z.enum(DRUG_FORMS).nullable().optional(),
    dose: optionalText(LIMITS.dose),
    route: z.enum(DRUG_ROUTES).nullable().optional(),
    frequency: z.enum(DRUG_FREQUENCY_CODES).nullable().optional(),
    frequencyText: optionalText(LIMITS.frequencyText),
    timing: z.enum(DRUG_TIMINGS).nullable().optional(),
    durationDays: z
      .number()
      .int('Whole days')
      .min(1, 'At least 1 day')
      .max(PRESCRIPTION_RULES.maxDurationDays, `At most ${PRESCRIPTION_RULES.maxDurationDays} days`)
      .nullable()
      .optional(),
    quantity: optionalText(LIMITS.quantity),
    instructions: optionalText(LIMITS.instructions),
    acknowledgeAllergy: z.boolean().optional(),
  })
  .refine((i) => i.frequency !== 'other' || !!i.frequencyText, {
    path: ['frequencyText'],
    message: 'Describe the frequency',
  });

/** PUT /encounters/:id/prescription – create or replace the draft's items. */
export const putPrescriptionSchema = {
  params: idParams,
  body: z.strictObject({
    /** The draft's `revision` when one exists (409 CONFLICT if stale); omit to create. */
    expectedVersion: z.number().int().min(0).optional(),
    items: z
      .array(item)
      .max(PRESCRIPTION_RULES.maxItems, `At most ${PRESCRIPTION_RULES.maxItems} items`),
    generalInstructions: optionalText(LIMITS.generalInstructions),
  }),
};

const reason = z
  .string()
  .trim()
  .min(
    PRESCRIPTION_RULES.reasonMinLength,
    `At least ${PRESCRIPTION_RULES.reasonMinLength} characters`,
  )
  .max(
    PRESCRIPTION_RULES.reasonMaxLength,
    `At most ${PRESCRIPTION_RULES.reasonMaxLength} characters`,
  );

/** POST /prescriptions/:id/cancel and /reissue. */
export const prescriptionReasonSchema = { params: idParams, body: z.strictObject({ reason }) };

/** POST /prescriptions/:id/issue (a reissued draft). */
export const issuePrescriptionSchema = {
  params: idParams,
  body: z.strictObject({ expectedVersion: z.number().int().min(0).optional() }).optional(),
};

export const prescriptionIdSchema = { params: idParams };

/** GET /prescriptions. Receptionists must name a patient or an appointment (printing). */
export const listPrescriptionsSchema = {
  query: z
    .object({
      ...paginationQuery,
      patient: objectId.optional(),
      appointment: objectId.optional(),
      encounter: objectId.optional(),
      status: z.enum(PRESCRIPTION_STATUSES).optional(),
      /** Clinic dates of issue (inclusive). */
      from: dateOnly.optional(),
      to: dateOnly.optional(),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

export type PutPrescriptionInput = z.infer<typeof putPrescriptionSchema.body>;
export type PrescriptionItemInput = PutPrescriptionInput['items'][number];
export type ListPrescriptionsQuery = z.infer<typeof listPrescriptionsSchema.query>;
