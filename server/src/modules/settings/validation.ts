import { z } from 'zod';
import { EXPLANATION_LANGUAGES, PAYMENT_METHODS } from '../../config/constants.js';
import { email, optionalText, phone, timezone } from '../../utils/zod.js';

const int = (min: number, max: number) =>
  z.number().int('Must be a whole number').min(min).max(max);

/** Array with no repeated values. */
const unique = <T extends z.ZodType>(item: T, label: string) =>
  z
    .array(item)
    .refine((a) => new Set(a).size === a.length, `${label} must not repeat`)
    .optional();

/** 15-character Indian GSTIN, e.g. 29ABCDE1234F1Z5. */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');

const url = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url({ protocol: /^https?$/, error: 'Enter a valid http(s) URL' }));

/** A field that can be cleared with null or ''. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal('').transform(() => null), z.null(), schema]).optional();

/**
 * PATCH /settings – deep partial (spec §7.4). Every key is optional; unknown keys are rejected
 * so typos are not silently ignored. Arrays replace the stored array.
 */
export const updateSettingsSchema = {
  body: z
    .strictObject({
      name: z.string().trim().min(1, 'Required').max(120).optional(),
      logoUrl: clearable(url),
      tagline: optionalText(160),
      registrationNumber: optionalText(50),
      gstin: clearable(gstin),
      address: z
        .strictObject({
          line1: optionalText(120),
          line2: optionalText(120),
          city: optionalText(60),
          state: optionalText(60),
          postalCode: clearable(
            z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid postal code'),
          ),
          country: optionalText(60),
        })
        .optional(),
      phone: clearable(phone),
      email: clearable(email),
      website: clearable(url),
      timezone: timezone.optional(),
      currency: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code (e.g. INR)')
        .optional(),
      workingDays: unique(int(0, 6), 'Working days').refine(
        (d) => d === undefined || d.length > 0,
        'Choose at least one working day',
      ),
      appointment: z
        .strictObject({
          defaultSlotMinutes: int(5, 120).optional(),
          bookingWindowDays: int(1, 365).optional(),
          minCancelHours: int(0, 168).optional(),
          allowPatientSelfBooking: z.boolean().optional(),
          maxActiveBookingsPerPatient: int(1, 20).optional(),
          walkInOverbookPerSession: int(0, 20).optional(),
          noShowGraceMinutes: int(0, 240).optional(),
          reminderHoursBefore: int(1, 168).optional(),
        })
        .optional(),
      billing: z
        .strictObject({
          invoicePrefix: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z]{2,6}$/, 'Use 2–6 letters')
            .optional(),
          defaultTaxRateBps: int(0, 10_000).optional(),
          taxLabel: z.string().trim().min(1, 'Required').max(20).optional(),
          maxDiscountPercentWithoutAdmin: int(0, 100).optional(),
          paymentMethods: unique(z.enum(PAYMENT_METHODS), 'Payment methods').refine(
            (m) => m === undefined || m.length > 0,
            'Choose at least one payment method',
          ),
          invoiceFooter: optionalText(500),
        })
        .optional(),
      lab: z
        .strictObject({
          requireDualVerification: z.boolean().optional(),
          criticalAlertEnabled: z.boolean().optional(),
        })
        .optional(),
      ai: z
        .strictObject({
          enabled: z.boolean().optional(),
          clinicalSummaryEnabled: z.boolean().optional(),
          patientExplanationEnabled: z.boolean().optional(),
          explanationLanguages: unique(z.enum(EXPLANATION_LANGUAGES), 'Languages').refine(
            (l) => l === undefined || l.length > 0,
            'Choose at least one language',
          ),
        })
        .optional(),
      notifications: z.strictObject({ emailEnabled: z.boolean().optional() }).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema.body>;
