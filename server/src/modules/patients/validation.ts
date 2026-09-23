import { z } from 'zod';
import {
  ALLERGY_SEVERITIES,
  BLOOD_GROUPS,
  GENDERS,
  PATIENT_LANGUAGES,
  PATIENT_RULES,
} from '../../config/constants.js';
import { calendarDate } from '../../utils/dates.js';
import {
  booleanQuery,
  dateOfBirth,
  dateOnly,
  email,
  idParams,
  namePart,
  objectId,
  optionalText,
  paginationQuery,
  phone,
  sortQuery,
} from '../../utils/zod.js';

/** An email, or '' / null to clear it. */
const optionalEmail = z
  .union([z.literal('').transform(() => null), email])
  .nullable()
  .optional();

/** A 'YYYY-MM-DD' calendar date as a UTC-midnight Date, or null to clear it. */
const optionalCalendarDate = dateOnly
  .transform((v) => calendarDate(v))
  .nullable()
  .optional();

const address = z.strictObject({
  line1: optionalText(120),
  line2: optionalText(120),
  city: optionalText(60),
  state: optionalText(60),
  postalCode: optionalText(12),
  country: optionalText(60),
});

const emergencyContact = z.strictObject({
  name: optionalText(100),
  relation: optionalText(40),
  phone: phone.nullable().optional(),
});

const insurance = z.strictObject({
  provider: optionalText(100),
  policyNumber: optionalText(60),
  validTill: optionalCalendarDate,
});

/** An allergy. `id` keeps an existing entry (and who recorded it) when it is unchanged. */
const allergy = z.strictObject({
  id: objectId.optional(),
  substance: z.string().trim().min(1, 'Required').max(100, 'At most 100 characters'),
  reaction: optionalText(200),
  severity: z.enum(ALLERGY_SEVERITIES),
});

const chronicCondition = z.strictObject({
  id: objectId.optional(),
  name: z.string().trim().min(1, 'Required').max(120, 'At most 120 characters'),
  since: optionalCalendarDate,
  notes: optionalText(500),
});

const allergies = z.array(allergy).max(50, 'At most 50 allergies');
const chronicConditions = z.array(chronicCondition).max(50, 'At most 50 conditions');

const communications = z.strictObject({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
});

const reason = z
  .string()
  .trim()
  .min(
    PATIENT_RULES.overrideReasonMinLength,
    `At least ${PATIENT_RULES.overrideReasonMinLength} characters`,
  )
  .max(500, 'At most 500 characters');

/** Demographic fields reception (and admins) edit; all optional on update. */
const demographics = {
  firstName: namePart,
  lastName: namePart,
  dateOfBirth,
  gender: z.enum(GENDERS),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  phone,
  email: optionalEmail,
  address: address.nullable().optional(),
  emergencyContact: emergencyContact.nullable().optional(),
  insurance: insurance.nullable().optional(),
  preferredLanguage: z.enum(PATIENT_LANGUAGES).optional(),
  adminNotes: optionalText(2000),
};

/** `force: true` (create anyway despite possible duplicates) needs a reason (spec §4.3). */
const duplicateOverride = {
  force: z.boolean().optional(),
  reason: z.string().trim().max(500, 'At most 500 characters').optional(),
};

function requireReasonWhenForced(b: { force?: boolean; reason?: string }, ctx: z.RefinementCtx) {
  if (b.force && (b.reason?.length ?? 0) < PATIENT_RULES.overrideReasonMinLength) {
    ctx.addIssue({
      code: 'custom',
      path: ['reason'],
      message: `Give a reason of at least ${PATIENT_RULES.overrideReasonMinLength} characters`,
    });
  }
}

/** POST /patients (spec §4.3). Allergies only from receptionists (checked in the service). */
export const createPatientSchema = {
  body: z
    .strictObject({
      ...demographics,
      allergies: allergies.optional(),
      consent: z.strictObject({
        dataProcessing: z.literal(true, 'Consent to data processing is required'),
        aiExplanations: z.boolean().optional(),
        communications: communications.optional(),
      }),
      ...duplicateOverride,
    })
    .superRefine(requireReasonWhenForced),
};

/** PATCH /patients/:id. Changing phone or date of birth re-runs the duplicate check. */
export const updatePatientSchema = {
  params: idParams,
  body: z
    .strictObject({
      firstName: demographics.firstName.optional(),
      lastName: demographics.lastName.optional(),
      dateOfBirth: demographics.dateOfBirth.optional(),
      gender: demographics.gender.optional(),
      bloodGroup: demographics.bloodGroup,
      phone: demographics.phone.optional(),
      email: demographics.email,
      address: demographics.address,
      emergencyContact: demographics.emergencyContact,
      insurance: demographics.insurance,
      preferredLanguage: demographics.preferredLanguage,
      adminNotes: demographics.adminNotes,
      allergies: allergies.optional(),
      ...duplicateOverride,
    })
    .superRefine(requireReasonWhenForced)
    .refine(
      (b) => Object.keys(b).some((k) => k !== 'force' && k !== 'reason'),
      'Nothing to update',
    ),
};

/** PATCH /patients/:id/clinical-profile – doctor with a care relationship. */
export const clinicalProfileSchema = {
  params: idParams,
  body: z
    .strictObject({
      allergies: allergies.optional(),
      chronicConditions: chronicConditions.optional(),
    })
    .refine(
      (b) => b.allergies !== undefined || b.chronicConditions !== undefined,
      'Nothing to update',
    ),
};

/** POST /patients/:id/deactivate and /activate. */
export const patientStatusSchema = {
  params: idParams,
  body: z.strictObject({
    reason: z
      .string()
      .trim()
      .min(
        PATIENT_RULES.statusReasonMinLength,
        `At least ${PATIENT_RULES.statusReasonMinLength} characters`,
      )
      .max(500, 'At most 500 characters'),
  }),
};

export const patientIdSchema = { params: idParams };

const age = z.coerce.number().int('Whole years').min(0).max(PATIENT_RULES.maxAgeYears);

/** GET /patients (spec §7.7, §12.1). */
export const listPatientsSchema = {
  query: z
    .object({
      ...paginationQuery,
      q: z.string().trim().min(1).max(100).optional(),
      gender: z.enum(GENDERS).optional(),
      ageMin: age.optional(),
      ageMax: age.optional(),
      /** Clinic dates (inclusive). */
      registeredFrom: dateOnly.optional(),
      registeredTo: dateOnly.optional(),
      hasPortal: booleanQuery,
      /** Admins only; everyone else sees active patients. */
      isActive: booleanQuery,
      sort: sortQuery(['lastName', 'createdAt', 'mrn'], { createdAt: -1 }),
    })
    .refine((q) => q.ageMin === undefined || q.ageMax === undefined || q.ageMin <= q.ageMax, {
      path: ['ageMax'],
      message: 'Must be at least ageMin',
    })
    .refine((q) => !q.registeredFrom || !q.registeredTo || q.registeredFrom <= q.registeredTo, {
      path: ['registeredTo'],
      message: 'Must be on or after registeredFrom',
    }),
};

/** GET /patients/check-duplicate: DOB plus a phone and/or first + last name (spec §4.3). */
export const checkDuplicateSchema = {
  query: z
    .object({
      dateOfBirth,
      phone: phone.optional(),
      firstName: namePart.optional(),
      lastName: namePart.optional(),
    })
    .refine((q) => q.phone || (q.firstName && q.lastName), {
      path: ['phone'],
      message: 'Give a phone number or first and last name',
    }),
};

/** PATCH /patients/me – what a patient may change themselves (not name, DOB or gender). */
export const updateMyRecordSchema = {
  body: z
    .strictObject({
      phone: phone.optional(),
      email: optionalEmail,
      address: address.nullable().optional(),
      emergencyContact: emergencyContact.nullable().optional(),
      preferredLanguage: z.enum(PATIENT_LANGUAGES).optional(),
      consent: z
        .strictObject({
          aiExplanations: z.boolean().optional(),
          communications: communications.optional(),
        })
        .optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
};

/** GET /patients/pending-links */
export const pendingLinksSchema = { query: z.object({ ...paginationQuery }) };

/** POST /patients/:id/confirm-link */
export const confirmLinkSchema = {
  params: idParams,
  body: z.strictObject({ userId: objectId }),
};

/** POST /patients/:id/reject-link – why the sign-up is not this patient. */
export const rejectLinkSchema = {
  params: idParams,
  body: z.strictObject({ userId: objectId, reason }),
};

export type UpdateMyRecordInput = z.infer<typeof updateMyRecordSchema.body>;
export type CreatePatientInput = z.infer<typeof createPatientSchema.body>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema.body>;
export type ClinicalProfileInput = z.infer<typeof clinicalProfileSchema.body>;
export type ListPatientsQuery = z.infer<typeof listPatientsSchema.query>;
export type CheckDuplicateQuery = z.infer<typeof checkDuplicateSchema.query>;
export type AllergyInput = z.infer<typeof allergy>;
export type ChronicConditionInput = z.infer<typeof chronicCondition>;
