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

// ---- Appointments (Phase 4, server config/constants.ts) --------------------------------------

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  checked_in: 'Checked in',
  in_consultation: 'In consultation',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const APPOINTMENT_TYPES = ['new', 'follow_up', 'walk_in'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  new: 'New visit',
  follow_up: 'Follow-up',
  walk_in: 'Walk-in',
};

export const APPOINTMENT_SOURCES = ['reception', 'patient_portal', 'walk_in', 'doctor'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];
export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  reception: 'Reception',
  patient_portal: 'Patient portal',
  walk_in: 'Walk-in',
  doctor: 'Doctor',
};

/** Most urgent first (spec §8.4). */
export const APPOINTMENT_PRIORITIES = ['emergency', 'priority', 'normal'] as const;
export type AppointmentPriority = (typeof APPOINTMENT_PRIORITIES)[number];
export const APPOINTMENT_PRIORITY_LABELS: Record<AppointmentPriority, string> = {
  emergency: 'Emergency',
  priority: 'Priority',
  normal: 'Normal',
};

/** Staff reasons for rescheduling or cancelling: at least this many characters (server rule). */
export const APPOINTMENT_REASON_MIN = 3;

// ---- Clinical notes and prescriptions (Phase 5, server config/constants.ts) -------------------

export const ENCOUNTER_STATUSES = ['draft', 'signed', 'amended'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];
export const DIAGNOSIS_TYPES = ['provisional', 'final'] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];
export const DIAGNOSIS_TYPE_LABELS: Record<DiagnosisType, string> = {
  provisional: 'Provisional',
  final: 'Final',
};

export const VITAL_KEYS = [
  'bpSystolic',
  'bpDiastolic',
  'pulse',
  'temperatureC',
  'respiratoryRate',
  'spo2',
  'weightKg',
  'heightCm',
] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];

/**
 * Vitals: label, unit, the server's accepted range (§6.13, input validation) and a usual adult
 * range (display hint only – values outside it are highlighted, never blocked).
 */
export const VITALS: Record<
  VitalKey,
  { label: string; unit: string; min: number; max: number; step: number; usual?: [number, number] }
> = {
  bpSystolic: { label: 'BP systolic', unit: 'mmHg', min: 50, max: 260, step: 1, usual: [90, 139] },
  bpDiastolic: { label: 'BP diastolic', unit: 'mmHg', min: 30, max: 160, step: 1, usual: [60, 89] },
  pulse: { label: 'Pulse', unit: '/min', min: 20, max: 250, step: 1, usual: [60, 100] },
  temperatureC: {
    label: 'Temperature',
    unit: '°C',
    min: 30,
    max: 45,
    step: 0.1,
    usual: [36.1, 37.5],
  },
  respiratoryRate: {
    label: 'Respiratory rate',
    unit: '/min',
    min: 5,
    max: 60,
    step: 1,
    usual: [12, 20],
  },
  spo2: { label: 'SpO₂', unit: '%', min: 50, max: 100, step: 1, usual: [95, 100] },
  weightKg: { label: 'Weight', unit: 'kg', min: 0.5, max: 400, step: 0.1 },
  heightCm: { label: 'Height', unit: 'cm', min: 30, max: 250, step: 0.1 },
};
/** Usual adult BMI range (display hint). */
export const BMI_USUAL: [number, number] = [18.5, 24.9];

/** Text limits of the note fields (server ENCOUNTER_RULES.textLimits). */
export const NOTE_TEXT_LIMITS = {
  chiefComplaint: 1000,
  historyOfPresentIllness: 5000,
  pastHistory: 3000,
  examination: 5000,
  assessment: 3000,
  plan: 3000,
  adviceToPatient: 2000,
  followUpInstructions: 1000,
  diagnosisDescription: 300,
} as const;
export const MAX_DIAGNOSES = 20;
export const MAX_FOLLOW_UP_DAYS = 365;
export const AMENDMENT_REASON_MIN = 10;
/** Late documentation window (hours after the consultation was completed). */
export const DOCUMENTATION_WINDOW_HOURS = 72;
/** ICD-10 format such as J06.9 (the code list is not checked). */
export const ICD10_PATTERN = /^[A-Z]\d{2}(\.[A-Z0-9]{1,4})?$/;

/** The note fields a doctor edits and amends, with their labels. */
export const NOTE_FIELD_LABELS = {
  vitals: 'Vitals',
  chiefComplaint: 'Chief complaint',
  historyOfPresentIllness: 'History of present illness',
  pastHistory: 'Past history',
  examination: 'Examination',
  diagnoses: 'Diagnoses',
  assessment: 'Assessment',
  plan: 'Plan',
  adviceToPatient: 'Advice to patient',
  followUp: 'Follow-up',
} as const;
export type NoteField = keyof typeof NOTE_FIELD_LABELS;

export const PRESCRIPTION_STATUSES = ['draft', 'issued', 'completed', 'cancelled'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];
export const DRUG_FREQUENCY_LABELS = {
  OD: 'Once a day',
  BD: 'Twice a day',
  TDS: 'Three times a day',
  QID: 'Four times a day',
  HS: 'At bedtime',
  SOS: 'Only when needed',
  STAT: 'Immediately',
  weekly: 'Once a week',
  other: 'Other',
} as const;
export type DrugFrequency = keyof typeof DRUG_FREQUENCY_LABELS;
export const DRUG_TIMING_LABELS = {
  before_food: 'Before food',
  after_food: 'After food',
  with_food: 'With food',
  empty_stomach: 'Empty stomach',
  any: 'Any time',
} as const;
export type DrugTiming = keyof typeof DRUG_TIMING_LABELS;
