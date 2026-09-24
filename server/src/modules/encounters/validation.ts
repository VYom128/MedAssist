import { z } from 'zod';
import {
  DIAGNOSIS_TYPES,
  ENCOUNTER_RULES,
  ENCOUNTER_STATUSES,
  type VitalKey,
} from '../../config/constants.js';
import { calendarDate, clinicToday } from '../../utils/dates.js';
import {
  booleanQuery,
  dateOnly,
  idParams,
  objectId,
  optionalText,
  paginationQuery,
} from '../../utils/zod.js';
import { cachedTimezone } from '../settings/service.js';

const { vitals: RANGES, textLimits: LIMITS } = ENCOUNTER_RULES;

/** A vital sign within its §6.13 range; null clears it. */
const vital = (key: VitalKey) => {
  const [min, max] = RANGES[key];
  return z
    .number({ error: 'Must be a number' })
    .min(min, `Must be between ${min} and ${max}`)
    .max(max, `Must be between ${min} and ${max}`)
    .nullable()
    .optional();
};

/** Vitals to change (merged into the stored vitals); BMI is computed, never sent. */
const vitals = z.strictObject({
  bpSystolic: vital('bpSystolic'),
  bpDiastolic: vital('bpDiastolic'),
  pulse: vital('pulse'),
  temperatureC: vital('temperatureC'),
  respiratoryRate: vital('respiratoryRate'),
  spo2: vital('spo2'),
  weightKg: vital('weightKg'),
  heightCm: vital('heightCm'),
});

/** ICD-10 code such as 'J06.9' or 'E11' (format only; the code list is not checked). */
const icd10Code = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]\d{2}(\.[A-Z0-9]{1,4})?$/, 'Use an ICD-10 code such as J06.9')
      .nullable(),
  )
  .optional();

const diagnosis = z.strictObject({
  description: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(LIMITS.diagnosisDescription, `At most ${LIMITS.diagnosisDescription} characters`),
  icd10Code,
  type: z.enum(DIAGNOSIS_TYPES).default('provisional'),
  isPrimary: z.boolean().default(false),
});

const diagnoses = z
  .array(diagnosis)
  .max(ENCOUNTER_RULES.maxDiagnoses, `At most ${ENCOUNTER_RULES.maxDiagnoses} diagnoses`)
  .refine((d) => d.filter((x) => x.isPrimary).length <= 1, 'Only one diagnosis can be primary');

/**
 * Follow-up plan: after N days (1–365) or on a future clinic date, not both. Not required →
 * no days or date.
 */
const followUp = z
  .strictObject({
    required: z.boolean(),
    afterDays: z
      .number()
      .int('Whole days')
      .min(1, 'At least 1 day')
      .max(ENCOUNTER_RULES.maxFollowUpDays, `At most ${ENCOUNTER_RULES.maxFollowUpDays} days`)
      .nullable()
      .optional(),
    date: dateOnly.nullable().optional(),
    instructions: optionalText(LIMITS.followUpInstructions),
  })
  .superRefine((f, ctx) => {
    if (f.afterDays != null && f.date != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['date'],
        message: 'Give either a number of days or a date, not both',
      });
    }
    if (!f.required && (f.afterDays != null || f.date != null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['required'],
        message: 'Turn on "follow-up needed" to set when',
      });
    }
    if (f.date != null && f.date <= clinicToday(cachedTimezone())) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'Must be a future date' });
    }
  })
  .transform((f) => ({
    required: f.required,
    afterDays: f.afterDays ?? null,
    date: f.date ? calendarDate(f.date) : null,
    instructions: f.instructions ?? null,
  }));

/** The note fields a doctor edits (autosave and amendments). */
export const encounterFields = {
  vitals: vitals.optional(),
  chiefComplaint: optionalText(LIMITS.chiefComplaint),
  historyOfPresentIllness: optionalText(LIMITS.historyOfPresentIllness),
  pastHistory: optionalText(LIMITS.pastHistory),
  examination: optionalText(LIMITS.examination),
  diagnoses: diagnoses.optional(),
  assessment: optionalText(LIMITS.assessment),
  plan: optionalText(LIMITS.plan),
  adviceToPatient: optionalText(LIMITS.adviceToPatient),
  followUp: followUp.optional(),
};

/** `revision` from the last read; a different stored one → 409 CONFLICT. */
const expectedVersion = z.number({ error: 'Send the revision you last loaded' }).int().min(0);

/** PATCH /encounters/:id (autosave). At least one field besides expectedVersion. */
export const updateEncounterSchema = {
  params: idParams,
  body: z
    .strictObject({ expectedVersion, ...encounterFields })
    .refine((b) => Object.keys(b).some((k) => k !== 'expectedVersion'), 'Nothing to update'),
};

/** POST /encounters/:id/sign – the revision the doctor is signing (409 CONFLICT if stale). */
export const signEncounterSchema = {
  params: idParams,
  body: z.strictObject({ expectedVersion }),
};

/**
 * POST /encounters/:id/amendments – a reason and the note fields to change (not the
 * prescription: that is cancelled or reissued).
 */
export const amendEncounterSchema = {
  params: idParams,
  body: z.strictObject({
    reason: z
      .string()
      .trim()
      .min(
        ENCOUNTER_RULES.amendmentReasonMinLength,
        `At least ${ENCOUNTER_RULES.amendmentReasonMinLength} characters`,
      )
      .max(1000, 'At most 1000 characters'),
    changes: z
      .strictObject(encounterFields)
      .refine((c) => Object.values(c).some((v) => v !== undefined), 'Nothing to amend'),
  }),
};

/** GET /encounters (doctor). `from`/`to` are clinic dates of the visit (inclusive). */
export const listEncountersSchema = {
  query: z
    .object({
      ...paginationQuery,
      patient: objectId.optional(),
      /** Only the caller's own notes (the doctor's "Notes" page). */
      mine: booleanQuery,
      status: z.enum(ENCOUNTER_STATUSES).optional(),
      from: dateOnly.optional(),
      to: dateOnly.optional(),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      path: ['to'],
      message: 'Must be on or after from',
    }),
};

export const encounterIdSchema = { params: idParams };

export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema.body>;
export type SignEncounterInput = z.infer<typeof signEncounterSchema.body>;
export type AmendEncounterInput = z.infer<typeof amendEncounterSchema.body>;
export type ListEncountersQuery = z.infer<typeof listEncountersSchema.query>;
