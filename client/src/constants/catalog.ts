/** Mirrors the Phase 2 enums in server/src/config/constants.ts. */

export const SERVICE_TYPES = ['consultation', 'procedure', 'other'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  consultation: 'Consultation',
  procedure: 'Procedure',
  other: 'Other',
};

export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'insurance', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  insurance: 'Insurance',
  other: 'Other',
};

export const EXPLANATION_LANGUAGES = ['en', 'hi'] as const;
export type ExplanationLanguage = (typeof EXPLANATION_LANGUAGES)[number];
export const LANGUAGE_LABELS: Record<ExplanationLanguage, string> = { en: 'English', hi: 'Hindi' };

/** Index = weekday number (0 = Sunday), as the server stores it. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Monday-first display order. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const LEAVE_TYPES = ['leave', 'conference', 'emergency', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  leave: 'Leave',
  conference: 'Conference',
  emergency: 'Emergency',
  other: 'Other',
};

export const LAB_TEST_CATEGORIES = [
  'haematology',
  'biochemistry',
  'microbiology',
  'immunology',
  'urine',
  'imaging',
  'other',
] as const;
export type LabTestCategory = (typeof LAB_TEST_CATEGORIES)[number];
export const LAB_SAMPLE_TYPES = ['blood', 'urine', 'stool', 'swab', 'sputum', 'other'] as const;
export type LabSampleType = (typeof LAB_SAMPLE_TYPES)[number];
export const LAB_VALUE_TYPES = ['number', 'text', 'option'] as const;
export type LabValueType = (typeof LAB_VALUE_TYPES)[number];
export const RANGE_GENDERS = ['any', 'male', 'female'] as const;
export type RangeGender = (typeof RANGE_GENDERS)[number];

/** "haematology" → "Haematology" */
export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const optionsOf = <T extends string>(values: readonly T[], labels?: Record<T, string>) =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? capitalise(v) }));

/** Patient record enums (server/src/config/constants.ts, spec §6.11). */
export const GENDERS = ['male', 'female', 'other', 'unknown'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  unknown: 'Not recorded',
};
/** "M", "F", "O", "–" for compact "34 y · F" labels. */
export const GENDER_SHORT: Record<Gender, string> = {
  male: 'M',
  female: 'F',
  other: 'O',
  unknown: '–',
};
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export const BLOOD_GROUP_LABELS = Object.fromEntries(
  BLOOD_GROUPS.map((g) => [g, g === 'unknown' ? 'Not known' : g]),
) as Record<BloodGroup, string>;
export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];
export const PATIENT_LANGUAGES = EXPLANATION_LANGUAGES;
export type PatientLanguage = ExplanationLanguage;
