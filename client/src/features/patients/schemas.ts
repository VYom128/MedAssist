import { z } from 'zod';
import {
  ALLERGY_SEVERITIES,
  BLOOD_GROUPS,
  GENDERS,
  PATIENT_LANGUAGES,
} from '../../constants/catalog';
import { clinicDate } from '../../utils/dates';
import { isBlankPhone, normalisePhone, PHONE_PREFIX } from '../../utils/phone';
import type { AllergyInput, MyDetailsBody, Patient, PatientBody } from './api';

// Mirrors server/src/modules/patients/validation.ts.

const namePart = z.string().trim().min(1, 'Required').max(50, 'At most 50 characters');
const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

/** Latest valid date of birth: today in the clinic; earliest: 120 years ago. */
export function dateOfBirthProblem(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Enter a date of birth';
  const today = clinicDate();
  if (value > today) return 'Date of birth cannot be in the future';
  const earliest = `${Number(today.slice(0, 4)) - 120}${today.slice(4)}`;
  if (value < earliest) return 'Enter a valid date of birth';
  return null;
}

export const dateOfBirthField = z.string().superRefine((v, ctx) => {
  const problem = dateOfBirthProblem(v);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** A required phone in any format (Indian by default). */
export const phoneField = z
  .string()
  .refine((v) => normalisePhone(v) !== null, 'Enter a valid phone number');
/** An optional phone: blank or only "+91" is fine. */
const optionalPhoneField = z
  .string()
  .refine((v) => isBlankPhone(v) || normalisePhone(v) !== null, 'Enter a valid phone number');
const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email');

const address = z.object({
  line1: text(120),
  line2: text(120),
  city: text(60),
  state: text(60),
  postalCode: text(12),
  country: text(60),
});
const emergencyContact = z.object({
  name: text(100),
  relation: text(40),
  phone: optionalPhoneField,
});

const allergy = z.object({
  id: z.string().optional(),
  substance: z.string().trim().min(1, 'Enter the substance').max(100, 'At most 100 characters'),
  reaction: text(200),
  severity: z.enum(ALLERGY_SEVERITIES, 'Choose a severity'),
});

/** The patient form (new patient and edit), as strings the inputs hold. */
export const patientFormSchema = z.object({
  firstName: namePart,
  lastName: namePart,
  dateOfBirth: dateOfBirthField,
  gender: z.enum(GENDERS, 'Choose a gender'),
  bloodGroup: z.enum(BLOOD_GROUPS),
  phone: phoneField,
  email: optionalEmail,
  address,
  emergencyContact,
  allergies: z.array(allergy).max(50, 'At most 50 allergies'),
  insurance: z.object({
    provider: text(100),
    policyNumber: text(60),
    validTill: z.string(),
  }),
  preferredLanguage: z.enum(PATIENT_LANGUAGES),
  adminNotes: text(2000),
  consent: z.object({
    dataProcessing: z.boolean(),
    aiExplanations: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
  }),
});

/** New patient: consent to data processing is required (spec §10.6). */
export const newPatientSchema = patientFormSchema.extend({
  consent: patientFormSchema.shape.consent.extend({
    dataProcessing: z
      .boolean()
      .refine((v) => v, 'Consent to data processing is required to register a patient'),
  }),
});

export type PatientFormValues = z.infer<typeof patientFormSchema>;

const blank = (v: string) => (v.trim() === '' ? null : v.trim());
const allBlank = (o: Record<string, string>) => Object.values(o).every((v) => isBlankPhone(v));

export const emptyPatientForm = (): PatientFormValues => ({
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '' as never,
  bloodGroup: 'unknown',
  phone: PHONE_PREFIX,
  email: '',
  address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India' },
  emergencyContact: { name: '', relation: '', phone: PHONE_PREFIX },
  allergies: [],
  insurance: { provider: '', policyNumber: '', validTill: '' },
  preferredLanguage: 'en',
  adminNotes: '',
  consent: { dataProcessing: false, aiExplanations: true, email: true, sms: false },
});

/** Form values for an existing patient (edit mode). */
export function patientToForm(p: Patient): PatientFormValues {
  const s = (v: string | null | undefined) => v ?? '';
  const empty = emptyPatientForm();
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth,
    gender: p.gender,
    bloodGroup: p.bloodGroup,
    phone: p.phone,
    email: s(p.email),
    address: { ...empty.address, country: '', ...mapStrings(p.address) },
    emergencyContact: {
      name: s(p.emergencyContact?.name),
      relation: s(p.emergencyContact?.relation),
      phone: p.emergencyContact?.phone ?? PHONE_PREFIX,
    },
    allergies: (p.allergies ?? []).map((a) => ({
      id: a.id,
      substance: a.substance,
      reaction: s(a.reaction),
      severity: a.severity,
    })),
    insurance: {
      provider: s(p.insurance?.provider),
      policyNumber: s(p.insurance?.policyNumber),
      validTill: s(p.insurance?.validTill),
    },
    preferredLanguage: p.preferredLanguage,
    adminNotes: s(p.adminNotes),
    consent: {
      dataProcessing: p.consent.dataProcessing.given,
      aiExplanations: p.consent.aiExplanations.given,
      email: p.consent.communications.email,
      sms: p.consent.communications.sms,
    },
  };
}

function mapStrings(o: object | null | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(o ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : '']),
  );
}

const addressBody = (a: PatientFormValues['address']) =>
  allBlank({ ...a, country: a.country === 'India' ? '' : a.country })
    ? null
    : Object.fromEntries(Object.entries(a).map(([k, v]) => [k, blank(v)]));

const emergencyBody = (e: PatientFormValues['emergencyContact']) =>
  allBlank(e)
    ? null
    : {
        name: blank(e.name),
        relation: blank(e.relation),
        phone: isBlankPhone(e.phone) ? null : normalisePhone(e.phone),
      };

export const allergyBody = (a: PatientFormValues['allergies'][number]): AllergyInput => ({
  ...(a.id ? { id: a.id } : {}),
  substance: a.substance.trim(),
  reaction: blank(a.reaction),
  severity: a.severity,
});

/**
 * The API body for POST /patients (with consent) or PATCH /patients/:id. Blank optional fields
 * become null; phones are sent in E.164.
 * @param opts.allergies include allergies (receptionists only; admins cannot record them)
 * @param opts.consent include consent (new patients only)
 */
export function toPatientBody(
  v: PatientFormValues,
  opts: { allergies: boolean; consent: boolean },
): PatientBody {
  const insurance = allBlank(v.insurance)
    ? null
    : {
        provider: blank(v.insurance.provider),
        policyNumber: blank(v.insurance.policyNumber),
        validTill: blank(v.insurance.validTill),
      };
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    dateOfBirth: v.dateOfBirth,
    gender: v.gender,
    bloodGroup: v.bloodGroup,
    phone: normalisePhone(v.phone) ?? v.phone,
    email: blank(v.email),
    address: addressBody(v.address),
    emergencyContact: emergencyBody(v.emergencyContact),
    insurance,
    preferredLanguage: v.preferredLanguage,
    adminNotes: blank(v.adminNotes),
    ...(opts.allergies ? { allergies: v.allergies.map(allergyBody) } : {}),
    ...(opts.consent
      ? {
          consent: {
            dataProcessing: true as const,
            aiExplanations: v.consent.aiExplanations,
            communications: { email: v.consent.email, sms: v.consent.sms },
          },
        }
      : {}),
  };
}

/** The patient's own details form (/patient/profile). */
export const myDetailsSchema = z.object({
  phone: phoneField,
  email: optionalEmail,
  address,
  emergencyContact,
  preferredLanguage: z.enum(PATIENT_LANGUAGES),
});
export type MyDetailsValues = z.infer<typeof myDetailsSchema>;

export const myDetailsToForm = (p: Patient): MyDetailsValues => {
  const f = patientToForm(p);
  return {
    phone: f.phone,
    email: f.email,
    address: f.address,
    emergencyContact: f.emergencyContact,
    preferredLanguage: f.preferredLanguage,
  };
};

export const toMyDetailsBody = (v: MyDetailsValues): MyDetailsBody => ({
  phone: normalisePhone(v.phone) ?? v.phone,
  email: blank(v.email),
  address: addressBody(v.address),
  emergencyContact: emergencyBody(v.emergencyContact),
  preferredLanguage: v.preferredLanguage,
});

/** Fields the duplicate check needs, or null while they are incomplete (spec §4.3). */
export function duplicateCriteria(v: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
}) {
  if (dateOfBirthProblem(v.dateOfBirth)) return null;
  const phone = normalisePhone(v.phone);
  const names = v.firstName.trim() && v.lastName.trim();
  if (!phone && !names) return null;
  return {
    dateOfBirth: v.dateOfBirth,
    ...(phone ? { phone } : {}),
    ...(names ? { firstName: v.firstName.trim(), lastName: v.lastName.trim() } : {}),
  };
}

/** Max date for date-of-birth inputs (today in the clinic). */
export const maxBirthDate = () => clinicDate();
