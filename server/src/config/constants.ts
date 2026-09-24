// Enums shared by schemas, Zod validators and (mirrored) the client. Statuses and state machine
// transitions for later modules are added here as they arrive.

/** User roles (spec §2.1). A user has exactly one. */
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  DOCTOR: 'doctor',
  RECEPTIONIST: 'receptionist',
  LABTECH: 'labtech',
  PATIENT: 'patient',
} as const);
export type Role = (typeof ROLES)[keyof typeof ROLES];
export const ROLE_VALUES = Object.freeze(Object.values(ROLES)) as readonly Role[];
export const STAFF_ROLES = Object.freeze([
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.RECEPTIONIST,
  ROLES.LABTECH,
] as const);
/**
 * Roles an admin can create through POST /users. Doctors are created with their profile through
 * POST /doctors (one transaction); patients sign up or are invited (Phase 3).
 */
export const USER_CREATABLE_ROLES = Object.freeze([
  ROLES.ADMIN,
  ROLES.RECEPTIONIST,
  ROLES.LABTECH,
] as const);

/** Patient portal link state (spec §4.4). Set from Phase 3. */
export const PATIENT_LINK_STATUSES = Object.freeze(['linked', 'pending_verification'] as const);
export type PatientLinkStatus = (typeof PATIENT_LINK_STATUSES)[number];

/** Patient record enums (spec §6.11). */
export const GENDERS = Object.freeze(['male', 'female', 'other', 'unknown'] as const);
export type Gender = (typeof GENDERS)[number];
export const BLOOD_GROUPS = Object.freeze([
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
  'unknown',
] as const);
export const ALLERGY_SEVERITIES = Object.freeze(['mild', 'moderate', 'severe'] as const);
/** Patient preferred language (spec §6.11); the same languages AI explanations support. */
export const PATIENT_LANGUAGES = Object.freeze(['en', 'hi'] as const);
/** Why a possible duplicate matched (spec §4.3): same phone + DOB, or same name + DOB. */
export const DUPLICATE_MATCH_REASONS = Object.freeze(['phone_dob', 'name_dob'] as const);
export type DuplicateMatchReason = (typeof DUPLICATE_MATCH_REASONS)[number];

/**
 * Patient rules: date of birth at most 120 years ago; a duplicate override or a (de)activation
 * needs a reason of at least this many characters.
 */
export const PATIENT_RULES = Object.freeze({
  maxAgeYears: 120,
  overrideReasonMinLength: 10,
  statusReasonMinLength: 5,
  /** Default country for phone numbers without a +country code (spec §20). */
  defaultPhoneCountry: 'IN',
});

/** Human-readable number sequences (spec §8.10): counter key and prefix. */
export const SEQUENCES = Object.freeze({
  MRN: { key: 'mrn', prefix: 'MRN' },
  /** Yearly: the counter key is `appointment:<clinic year>` → 'APT-2026-000001'. */
  APPOINTMENT: { key: 'appointment', prefix: 'APT' },
  /** Yearly: `encounter:<clinic year>` → 'ENC-2026-000001'. */
  ENCOUNTER: { key: 'encounter', prefix: 'ENC' },
  /** Yearly: `prescription:<clinic year>` → 'RX-2026-000001' (assigned on issue). */
  PRESCRIPTION: { key: 'prescription', prefix: 'RX' },
} as const);

/** Appointment enums (spec §6.12). */
export const APPOINTMENT_STATUSES = Object.freeze([
  'scheduled',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
] as const);
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
/**
 * Appointments still to happen or under way. A patient may not hold two open appointments that
 * overlap, or two with the same doctor on one clinic day (spec §8.2).
 */
export const OPEN_APPOINTMENT_STATUSES = Object.freeze([
  'scheduled',
  'checked_in',
  'in_consultation',
] as const satisfies readonly AppointmentStatus[]);
export const APPOINTMENT_TYPES = Object.freeze(['new', 'follow_up', 'walk_in'] as const);
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_SOURCES = Object.freeze([
  'reception',
  'patient_portal',
  'walk_in',
  'doctor',
] as const);
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];
/** Queue priority, most urgent first (spec §8.4). */
export const APPOINTMENT_PRIORITIES = Object.freeze(['emergency', 'priority', 'normal'] as const);
export type AppointmentPriority = (typeof APPOINTMENT_PRIORITIES)[number];

/** Encounter (clinical note) enums (spec §6.13, §5.2). */
export const ENCOUNTER_STATUSES = Object.freeze(['draft', 'signed', 'amended'] as const);
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];
export const DIAGNOSIS_TYPES = Object.freeze(['provisional', 'final'] as const);

/**
 * Clinical note rules (spec §6.13, §8.5): text limits per field, vitals ranges, the late
 * documentation window (edit/sign up to 72 h after the appointment was completed) and the
 * shortest amendment reason.
 */
export const ENCOUNTER_RULES = Object.freeze({
  documentationWindowHours: 72,
  amendmentReasonMinLength: 10,
  maxDiagnoses: 20,
  maxFollowUpDays: 365,
  textLimits: Object.freeze({
    chiefComplaint: 1000,
    historyOfPresentIllness: 5000,
    pastHistory: 3000,
    examination: 5000,
    assessment: 3000,
    plan: 3000,
    adviceToPatient: 2000,
    followUpInstructions: 1000,
    diagnosisDescription: 300,
  }),
  /** [min, max] per vital sign (spec §6.13). */
  vitals: Object.freeze({
    bpSystolic: [50, 260],
    bpDiastolic: [30, 160],
    pulse: [20, 250],
    temperatureC: [30, 45],
    respiratoryRate: [5, 60],
    spo2: [50, 100],
    weightKg: [0.5, 400],
    heightCm: [30, 250],
  } as const),
});
export type VitalKey = keyof typeof ENCOUNTER_RULES.vitals;
/** Note fields a doctor edits (autosave PATCH) and amends (spec §7.10). */
export const ENCOUNTER_EDITABLE_FIELDS = Object.freeze([
  'vitals',
  'chiefComplaint',
  'historyOfPresentIllness',
  'pastHistory',
  'examination',
  'diagnoses',
  'assessment',
  'plan',
  'adviceToPatient',
  'followUp',
] as const);
export type EncounterEditableField = (typeof ENCOUNTER_EDITABLE_FIELDS)[number];

/** Prescription item enums (spec §6.16). */
export const DRUG_FORMS = Object.freeze([
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'drops',
  'cream',
  'ointment',
  'inhaler',
  'other',
] as const);
export type DrugForm = (typeof DRUG_FORMS)[number];
export const DRUG_ROUTES = Object.freeze([
  'oral',
  'topical',
  'iv',
  'im',
  'sc',
  'inhalation',
  'ophthalmic',
  'otic',
  'nasal',
  'other',
] as const);
export type DrugRoute = (typeof DRUG_ROUTES)[number];
/** Dosing frequency codes with the label printed for patients; 'other' needs frequencyText. */
export const DRUG_FREQUENCIES = Object.freeze({
  OD: 'Once a day',
  BD: 'Twice a day',
  TDS: 'Three times a day',
  QID: 'Four times a day',
  HS: 'At bedtime',
  SOS: 'Only when needed',
  STAT: 'Immediately',
  weekly: 'Once a week',
  other: 'Other',
} as const);
export type DrugFrequency = keyof typeof DRUG_FREQUENCIES;
export const DRUG_FREQUENCY_CODES = Object.freeze(Object.keys(DRUG_FREQUENCIES) as DrugFrequency[]);
/** Prescription statuses (spec §5.3, §6.16). */
export const PRESCRIPTION_STATUSES = Object.freeze([
  'draft',
  'issued',
  'completed',
  'cancelled',
] as const);
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

/**
 * Prescription rules (spec §6.16, §8.6): item limits, and the shortest reason for a
 * cancellation or reissue.
 */
export const PRESCRIPTION_RULES = Object.freeze({
  maxItems: 30,
  maxDurationDays: 365,
  reasonMinLength: 10,
  reasonMaxLength: 500,
  textLimits: Object.freeze({
    drugName: 120,
    genericName: 120,
    strength: 50,
    dose: 50,
    frequencyText: 100,
    quantity: 50,
    instructions: 300,
    generalInstructions: 1000,
  }),
});

/** Shown with every allergy warning (spec §4.7, §8.6). */
export const ALLERGY_CHECK_NOTICE =
  'Allergy check is a convenience name match against recorded allergies – not clinical decision support.';

export const DRUG_TIMINGS = Object.freeze([
  'before_food',
  'after_food',
  'with_food',
  'empty_stomach',
  'any',
] as const);
export type DrugTiming = (typeof DRUG_TIMINGS)[number];

/** Notification types (spec §11). Phase 10 stores them in-app; Phase 4 only emails. */
export const NOTIFICATION_TYPES = Object.freeze({
  APPOINTMENT_BOOKED: 'appointment.booked',
  APPOINTMENT_RESCHEDULED: 'appointment.rescheduled',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  APPOINTMENT_NO_SHOW: 'appointment.no_show',
  APPOINTMENT_REMINDER: 'appointment.reminder',
  LEAVE_AFFECTS_APPOINTMENTS: 'doctor.leave_affects_appointments',
  PRESCRIPTION_ISSUED: 'prescription.issued',
} as const);
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Appointment rules: slots starting within `minLeadMinutes` of now are not offered (spec §8.1
 * step 6); calendar and availability ranges are at most `maxRangeDays` days; staff give a reason
 * of at least `reasonMinLength` characters to reschedule or cancel (spec §8.3).
 */
export const APPOINTMENT_RULES = Object.freeze({
  minLeadMinutes: 15,
  maxRangeDays: 31,
  reasonMaxLength: 500,
  reasonMinLength: 3,
});

/**
 * Queue rules (spec §8.4): the estimated wait uses the doctor's average consultation over the
 * last `averageWindowDays`; the kiosk board shows the next `boardNextTokens` tokens.
 */
export const QUEUE_RULES = Object.freeze({ averageWindowDays: 30, boardNextTokens: 5 });

/**
 * Background jobs (spec §8.11): reminders and no-show marking run every 15 minutes in the clinic
 * timezone, prescription completion daily at 02:00. A reminder goes to appointments starting `reminderHoursBefore` from now, give or take
 * `reminderWindowMinutes`; each run handles at most `batchSize` appointments per job.
 */
export const JOB_RULES = Object.freeze({
  every15Minutes: '*/15 * * * *',
  /** Prescription completion (spec §8.11). */
  daily0200: '0 2 * * *',
  reminderWindowMinutes: 15,
  batchSize: 500,
});

/** Socket.IO events and rooms (spec §7.9). Event payloads carry ids only. */
export const SOCKET_EVENTS = Object.freeze({
  QUEUE_UPDATED: 'queue.updated',
  APPOINTMENT_CHANGED: 'appointment.changed',
  /** Client → server: join / leave a doctor's queue room for a date. */
  QUEUE_SUBSCRIBE: 'queue:subscribe',
  QUEUE_UNSUBSCRIBE: 'queue:unsubscribe',
});
export const SOCKET_ROOMS = Object.freeze({
  user: (userId: string) => `user:${userId}`,
  queue: (doctorId: string, date: string) => `queue:${doctorId}:${date}`,
  board: 'board',
});

/** Token counter key per doctor per clinic day (spec §8.4): 'token:<doctorId>:<YYYY-MM-DD>'. */
export const tokenCounterKey = (doctorId: string, date: string) => `token:${doctorId}:${date}`;

/**
 * State machines (spec §5): for each status, the statuses it may move to. Checked with
 * `assertTransition(machine, from, to)` (utils/stateMachine.ts) → 409 INVALID_STATUS_TRANSITION.
 * Later phases add encounter, prescription, lab order, invoice and follow-up machines here.
 */
export const STATE_MACHINES = Object.freeze({
  /** Spec §5.1. `scheduled → scheduled` is a reschedule; `no_show → scheduled` an undo. */
  appointment: Object.freeze({
    scheduled: ['scheduled', 'checked_in', 'cancelled', 'no_show'],
    checked_in: ['in_consultation', 'cancelled'],
    in_consultation: ['completed'],
    completed: [],
    cancelled: [],
    no_show: ['scheduled'],
  } satisfies Record<AppointmentStatus, readonly AppointmentStatus[]>),
  /** Spec §5.2. Each amendment moves to (or stays) 'amended' and increments `version`. */
  encounter: Object.freeze({
    draft: ['signed'],
    signed: ['amended'],
    amended: ['amended'],
  } satisfies Record<EncounterStatus, readonly EncounterStatus[]>),
  /**
   * Spec §5.3. Issued on signing (or POST /prescriptions/:id/issue for a reissued draft);
   * completed by the daily job; a change after issue = cancel + a new draft (reissue).
   */
  prescription: Object.freeze({
    draft: ['issued'],
    issued: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  } satisfies Record<PrescriptionStatus, readonly PrescriptionStatus[]>),
});
export type StateMachine = keyof typeof STATE_MACHINES;

/**
 * Why a session was revoked (spec §6.4, plus 'rotated' for a normal refresh and 'deactivated'
 * when an admin deactivates the account).
 */
export const SESSION_REVOKE_REASONS = Object.freeze([
  'logout',
  'logout_all',
  'rotated',
  'reuse_detected',
  'password_changed',
  'admin',
  'deactivated',
] as const);
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/**
 * Auth limits: lockout after 5 failed logins within 15 min, for 15 min (spec §5.8); reset links
 * valid 30 min; a rotated refresh token reused within 10 s (two tabs refreshing at once) gets an
 * access token for its replacement instead of being treated as theft.
 */
export const AUTH_LIMITS = Object.freeze({
  maxFailedLogins: 5,
  failedWindowMinutes: 15,
  lockMinutes: 15,
  resetTokenMinutes: 30,
  refreshGraceSeconds: 10,
});

/** Refresh token cookie (spec §7.1). */
export const REFRESH_COOKIE = Object.freeze({ name: 'ma_rt', path: '/api/v1/auth' });

/** CSRF protection for cookie-authenticated endpoints (spec §10.1). */
export const CSRF_HEADER = Object.freeze({ name: 'X-Requested-With', value: 'medassist' });

/** "Set your password" links emailed to new staff accounts are valid for 72 hours. */
export const ACCOUNT_SETUP_TTL_MS = 72 * 60 * 60_000;

/** Audit log (spec §6.25, §10.4). */
export const AUDIT_OUTCOMES = Object.freeze(['success', 'denied', 'failure'] as const);
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
/** Audit actions used so far; later phases add theirs from the §10.4 catalogue. */
export const AUDIT_ACTIONS = Object.freeze({
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_LOGOUT_ALL: 'auth.logout_all',
  AUTH_REFRESH_REUSE: 'auth.refresh_reuse',
  AUTH_SESSION_REVOKE: 'auth.session_revoke',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  AUTH_PASSWORD_RESET: 'auth.password_reset',
  AUTH_PROFILE_UPDATE: 'auth.profile_update',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DEACTIVATE: 'user.deactivate',
  USER_ACTIVATE: 'user.activate',
  USER_UNLOCK: 'user.unlock',
  USER_RESET_PASSWORD: 'user.reset_password',
  AUDIT_VERIFY: 'audit.verify',
  ACCESS_DENIED: 'access.denied',
  SETTINGS_UPDATE: 'settings.update',
  DEPARTMENT_CREATE: 'department.create',
  DEPARTMENT_UPDATE: 'department.update',
  DEPARTMENT_DEACTIVATE: 'department.deactivate',
  DEPARTMENT_ACTIVATE: 'department.activate',
  SERVICE_CREATE: 'service.create',
  SERVICE_UPDATE: 'service.update',
  SERVICE_DEACTIVATE: 'service.deactivate',
  SERVICE_ACTIVATE: 'service.activate',
  DOCTOR_CREATE: 'doctor.create',
  DOCTOR_UPDATE: 'doctor.update',
  DOCTOR_SCHEDULE_UPDATE: 'doctor.schedule_update',
  DOCTOR_LEAVE_CREATE: 'doctor.leave_create',
  DOCTOR_LEAVE_CANCEL: 'doctor.leave_cancel',
  LAB_TEST_CREATE: 'lab_test.create',
  LAB_TEST_UPDATE: 'lab_test.update',
  LAB_TEST_DEACTIVATE: 'lab_test.deactivate',
  LAB_TEST_ACTIVATE: 'lab_test.activate',
  PATIENT_CREATE: 'patient.create',
  PATIENT_CREATE_DUPLICATE_OVERRIDE: 'patient.create_duplicate_override',
  PATIENT_VIEW: 'patient.view',
  PATIENT_UPDATE: 'patient.update',
  PATIENT_UPDATE_DUPLICATE_OVERRIDE: 'patient.update_duplicate_override',
  PATIENT_CLINICAL_PROFILE_UPDATE: 'patient.clinical_profile_update',
  PATIENT_DEACTIVATE: 'patient.deactivate',
  PATIENT_ACTIVATE: 'patient.activate',
  PATIENT_PORTAL_INVITE: 'patient.portal_invite',
  PATIENT_LINK_CONFIRM: 'patient.link_confirm',
  PATIENT_LINK_REJECT: 'patient.link_reject',
  APPOINTMENT_CREATE: 'appointment.create',
  APPOINTMENT_UPDATE: 'appointment.update',
  APPOINTMENT_RESCHEDULE: 'appointment.reschedule',
  APPOINTMENT_CANCEL: 'appointment.cancel',
  APPOINTMENT_CHECK_IN: 'appointment.check_in',
  APPOINTMENT_START: 'appointment.start',
  APPOINTMENT_COMPLETE: 'appointment.complete',
  APPOINTMENT_NO_SHOW: 'appointment.no_show',
  APPOINTMENT_UNDO_NO_SHOW: 'appointment.undo_no_show',
  APPOINTMENT_PRIORITY_CHANGE: 'appointment.priority_change',
  ENCOUNTER_CREATE: 'encounter.create',
  ENCOUNTER_VIEW: 'encounter.view',
  ENCOUNTER_UPDATE: 'encounter.update',
  ENCOUNTER_SIGN: 'encounter.sign',
  ENCOUNTER_AMEND: 'encounter.amend',
  PRESCRIPTION_UPDATE: 'prescription.update',
  PRESCRIPTION_ISSUE: 'prescription.issue',
  PRESCRIPTION_CANCEL: 'prescription.cancel',
  PRESCRIPTION_REISSUE: 'prescription.reissue',
  PRESCRIPTION_COMPLETE: 'prescription.complete',
  PRESCRIPTION_VIEW: 'prescription.view',
} as const);
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
/**
 * The same user reading the same record within this window produces one audit entry (§10.4).
 * Autosaves of one clinical record by one user are debounced the same way.
 */
export const AUDIT_READ_DEBOUNCE_MS = 5 * 60_000;
/** prevHash of the first audit entry. */
export const AUDIT_GENESIS_HASH = 'GENESIS';

/**
 * Clinic settings are cached in memory (settings.service). An update refreshes the cache at once
 * on the instance that made it; this TTL bounds how stale other API instances can be.
 */
export const SETTINGS_CACHE_TTL_MS = 60_000;

/** Payment methods (spec §6.5 billing.paymentMethods; used by payments in Phase 7). */
export const PAYMENT_METHODS = Object.freeze([
  'cash',
  'card',
  'upi',
  'insurance',
  'other',
] as const);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Languages AI patient explanations support (spec §9.3). */
export const EXPLANATION_LANGUAGES = Object.freeze(['en', 'hi'] as const);

/** Billable service types (spec §6.7). */
export const SERVICE_TYPES = Object.freeze(['consultation', 'procedure', 'other'] as const);
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Profile fields a doctor may change on their own profile (spec §7.6); admins change all. */
export const DOCTOR_SELF_EDITABLE_FIELDS = Object.freeze(['bio', 'languages'] as const);

/** Weekly schedules (spec §6.9): session times on 5-minute steps, at most 6 sessions a day. */
export const SCHEDULE_RULES = Object.freeze({ stepMinutes: 5, maxSessionsPerDay: 6 });

/** Doctor leave types (spec §6.10). */
export const LEAVE_TYPES = Object.freeze(['leave', 'conference', 'emergency', 'other'] as const);
export type LeaveType = (typeof LEAVE_TYPES)[number];
/** Longest single leave record, in days. */
export const MAX_LEAVE_DAYS = 90;

/** Lab test catalogue enums (spec §6.19). */
export const LAB_TEST_CATEGORIES = Object.freeze([
  'haematology',
  'biochemistry',
  'microbiology',
  'immunology',
  'urine',
  'imaging',
  'other',
] as const);
export const LAB_SAMPLE_TYPES = Object.freeze([
  'blood',
  'urine',
  'stool',
  'swab',
  'sputum',
  'other',
] as const);
export const LAB_VALUE_TYPES = Object.freeze(['number', 'text', 'option'] as const);
export const RANGE_GENDERS = Object.freeze(['male', 'female', 'any'] as const);

/**
 * Scopes for canAccessPatient (spec §2.3). `allergies` is separate from `clinical` because
 * receptionists may view and record allergies (safety information) but nothing else clinical.
 */
export const PATIENT_ACCESS_SCOPES = Object.freeze([
  'demographics',
  'clinical',
  'billing',
  'lab',
  'allergies',
] as const);
export type PatientAccessScope = (typeof PATIENT_ACCESS_SCOPES)[number];

/** Error codes from spec §16. Use these instead of string literals. */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_PATIENT: 'DUPLICATE_PATIENT',
  // Not in §16: a self-registered patient whose record link awaits reception's identity check.
  PATIENT_LINK_PENDING: 'PATIENT_LINK_PENDING',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  PATIENT_DOUBLE_BOOKED: 'PATIENT_DOUBLE_BOOKED',
  DOCTOR_UNAVAILABLE: 'DOCTOR_UNAVAILABLE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  RECORD_LOCKED: 'RECORD_LOCKED',
  // Not in §16: generic 422 for business rules without a specific code (see ROADMAP Phase 0 notes).
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  CANCELLATION_WINDOW_PASSED: 'CANCELLATION_WINDOW_PASSED',
  BOOKING_LIMIT_REACHED: 'BOOKING_LIMIT_REACHED',
  // Not in §16 (Phase 4): patient self-booking is turned off in settings.
  SELF_BOOKING_DISABLED: 'SELF_BOOKING_DISABLED',
  // Not in §16 (Phase 4): a date in the past, or beyond bookingWindowDays for patients.
  OUTSIDE_BOOKING_WINDOW: 'OUTSIDE_BOOKING_WINDOW',
  // Not in §16 (Phase 4): the walk-in overbook allowance for the session is used up.
  OVERBOOK_LIMIT_REACHED: 'OVERBOOK_LIMIT_REACHED',
  // Not in §16 (Phase 5): a note edited or signed after the late documentation window (§8.5).
  DOCUMENTATION_WINDOW_CLOSED: 'DOCUMENTATION_WINDOW_CLOSED',
  // Not in §16 (Phase 5): a prescription item matching an allergy was not acknowledged (§8.6).
  ALLERGY_ACK_REQUIRED: 'ALLERGY_ACK_REQUIRED',
  // Not in §16 (Phase 5): the note is missing what signing needs; `details` lists it (§8.5).
  SIGN_VALIDATION_FAILED: 'SIGN_VALIDATION_FAILED',
  SELF_VERIFICATION_NOT_ALLOWED: 'SELF_VERIFICATION_NOT_ALLOWED',
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',
  DISCOUNT_REQUIRES_ADMIN: 'DISCOUNT_REQUIRES_ADMIN',
  // Not in §16: oversized JSON body (see ROADMAP Phase 0 notes). FILE_TOO_LARGE is for uploads.
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  RATE_LIMITED: 'RATE_LIMITED',
  AI_DISABLED: 'AI_DISABLED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_OUTPUT_INVALID: 'AI_OUTPUT_INVALID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const);

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** HTTP status for each error code (spec §16). */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  SESSION_REVOKED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_INACTIVE: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_PATIENT: 409,
  PATIENT_LINK_PENDING: 403,
  SLOT_UNAVAILABLE: 409,
  PATIENT_DOUBLE_BOOKED: 409,
  DOCTOR_UNAVAILABLE: 409,
  INVALID_STATUS_TRANSITION: 409,
  RECORD_LOCKED: 409,
  BUSINESS_RULE_VIOLATION: 422,
  CANCELLATION_WINDOW_PASSED: 422,
  BOOKING_LIMIT_REACHED: 422,
  SELF_BOOKING_DISABLED: 403,
  OUTSIDE_BOOKING_WINDOW: 422,
  OVERBOOK_LIMIT_REACHED: 422,
  DOCUMENTATION_WINDOW_CLOSED: 422,
  ALLERGY_ACK_REQUIRED: 422,
  SIGN_VALIDATION_FAILED: 422,
  SELF_VERIFICATION_NOT_ALLOWED: 422,
  PAYMENT_EXCEEDS_BALANCE: 422,
  DISCOUNT_REQUIRES_ADMIN: 422,
  PAYLOAD_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  RATE_LIMITED: 429,
  AI_DISABLED: 403,
  AI_UNAVAILABLE: 503,
  AI_OUTPUT_INVALID: 503,
  INTERNAL_ERROR: 500,
});

export const API_PREFIX = '/api/v1';

/** Max JSON / urlencoded body size. File uploads go through Multer with their own limit. */
export const BODY_LIMIT = '1mb';
