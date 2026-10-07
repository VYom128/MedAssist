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
  /** Yearly: `lab_order:<clinic year>` → 'LAB-2026-000001' (assigned when the order is placed). */
  LAB_ORDER: { key: 'lab_order', prefix: 'LAB' },
  /** Yearly: `sample:<clinic year>` → 'S26-000001' (two-digit year in the prefix). */
  SAMPLE: { key: 'sample', prefix: 'S' },
  /**
   * Yearly: `invoice:<clinic year>` → 'INV-2026-000001', assigned on issue. The prefix printed
   * is `settings.billing.invoicePrefix` (default 'INV'); the counter key never changes.
   */
  INVOICE: { key: 'invoice', prefix: 'INV' },
  /** Yearly: `payment:<clinic year>` → 'PAY-2026-000001' (payments and refunds). */
  PAYMENT: { key: 'payment', prefix: 'PAY' },
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
  /** Phase 8: whether the patient-safe view shows the diagnoses (draft PATCH or amendment). */
  'shareDiagnosisWithPatient',
] as const);
export type EncounterEditableField = (typeof ENCOUNTER_EDITABLE_FIELDS)[number];

/**
 * Patient timeline (spec §8.8, Phase 8): the item types, in the order they sort on equal times
 * (the cursor compares them as strings), and the page size.
 */
export const TIMELINE_TYPES = Object.freeze([
  'appointment',
  'document',
  'encounter',
  'followup_request',
  'invoice',
  'lab_order',
  'payment',
  'prescription',
] as const);
export type TimelineType = (typeof TIMELINE_TYPES)[number];
export const TIMELINE_RULES = Object.freeze({ defaultLimit: 20, maxLimit: 50 });
/**
 * Planned follow-ups shown to the patient (GET /patients/me/follow-ups-due): upcoming, or overdue
 * by at most `overdueDays`, and not yet booked.
 */
export const FOLLOW_UP_DUE_RULES = Object.freeze({ overdueDays: 14 });

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
  LAB_SAMPLE_REJECTED: 'lab.sample_rejected',
  LAB_CRITICAL_VALUE: 'lab.critical_value',
  LAB_RESULT_RELEASED: 'lab.result_released',
  LAB_RESULT_REVISED: 'lab.result_revised',
  INVOICE_ISSUED: 'invoice.issued',
  PAYMENT_RECEIVED: 'payment.received',
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
  /** Lab turnaround alerts (spec §8.11). */
  hourly: '0 * * * *',
  reminderWindowMinutes: 15,
  batchSize: 500,
});

/** Socket.IO events and rooms (spec §7.9). Event payloads carry ids only. */
export const SOCKET_EVENTS = Object.freeze({
  QUEUE_UPDATED: 'queue.updated',
  APPOINTMENT_CHANGED: 'appointment.changed',
  /** Lab orders were placed or changed: lab staff refetch the worklist (`{ orderIds }`). */
  LAB_WORKLIST_UPDATED: 'lab.worklist.updated',
  /** A lab order changed: its doctor (and, once released, its patient) refetch (`{ orderId }`). */
  LAB_ORDER_CHANGED: 'lab.order.changed',
  /** A critical result was entered: the ordering doctor's alert (`{ orderId }`). */
  LAB_CRITICAL: 'lab.critical',
  /** Client → server: join / leave a doctor's queue room for a date. */
  QUEUE_SUBSCRIBE: 'queue:subscribe',
  QUEUE_UNSUBSCRIBE: 'queue:unsubscribe',
});
export const SOCKET_ROOMS = Object.freeze({
  user: (userId: string) => `user:${userId}`,
  queue: (doctorId: string, date: string) => `queue:${doctorId}:${date}`,
  board: 'board',
  /** Every connected lab technician (worklist updates). */
  lab: 'lab',
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
  /**
   * Spec §5.4 plus Phase 6 decisions: `draft` (ordered during a consultation, placed when the
   * note is signed; `draft → cancelled` = discarded); an order whose items are all cancelled
   * becomes `cancelled` from any status before results (the doctor cancels a whole order only
   * before a sample is held: ordered or sample_rejected – checked in the service);
   * `released → released` is a revision.
   */
  labOrder: Object.freeze({
    draft: ['ordered', 'cancelled'],
    ordered: ['sample_collected', 'cancelled'],
    sample_collected: ['sample_rejected', 'processing', 'cancelled'],
    sample_rejected: ['ordered', 'cancelled'],
    processing: ['result_entered', 'cancelled'],
    result_entered: ['processing', 'verified'],
    verified: ['released'],
    released: ['released'],
    cancelled: [],
  } satisfies Record<LabOrderStatus, readonly LabOrderStatus[]>),
  /**
   * Spec §5.5 plus Phase 7 decisions: a draft can be voided (appointment cancelled, or by
   * staff); after issue the status follows the amounts (payments and refunds): nothing paid →
   * issued, part → partially_paid, all → paid. Void only while nothing is paid (net of refunds).
   */
  invoice: Object.freeze({
    draft: ['issued', 'void'],
    issued: ['partially_paid', 'paid', 'void'],
    partially_paid: ['partially_paid', 'paid', 'issued', 'void'],
    paid: ['partially_paid', 'issued'],
    void: [],
  } satisfies Record<InvoiceStatus, readonly InvoiceStatus[]>),
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
  /** Phase 8: a read of a patient's timeline (debounced like other clinical reads). */
  PATIENT_TIMELINE_VIEW: 'patient.timeline_view',
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
  LAB_ORDER_CREATE: 'lab_order.create',
  LAB_ORDER_UPDATE: 'lab_order.update',
  LAB_ORDER_DISCARD: 'lab_order.discard',
  LAB_ORDER_SUBMIT: 'lab_order.submit',
  LAB_ORDER_CANCEL: 'lab_order.cancel',
  LAB_ORDER_ITEM_CANCEL: 'lab_order.item_cancel',
  LAB_ORDER_VIEW: 'lab_order.view',
  LAB_ORDER_COLLECT_SAMPLE: 'lab_order.collect_sample',
  LAB_ORDER_REJECT_SAMPLE: 'lab_order.reject_sample',
  LAB_ORDER_RECOLLECT: 'lab_order.recollect',
  LAB_ORDER_START_PROCESSING: 'lab_order.start_processing',
  LAB_ORDER_RESULTS_ENTER: 'lab_order.results_enter',
  LAB_ORDER_VERIFY: 'lab_order.verify',
  LAB_ORDER_SEND_BACK: 'lab_order.send_back',
  LAB_ORDER_RELEASE: 'lab_order.release',
  LAB_ORDER_REVISE: 'lab_order.revise',
  LAB_ORDER_REVISION_VERIFY: 'lab_order.revision_verify',
  LAB_ORDER_ACKNOWLEDGE: 'lab_order.acknowledge',
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_VIEW: 'document.view',
  DOCUMENT_DOWNLOAD: 'document.download',
  DOCUMENT_DELETE: 'document.delete',
  INVOICE_CREATE: 'invoice.create',
  INVOICE_UPDATE: 'invoice.update',
  /** Lines added, removed or flagged by the system (lab orders placed or cancelled). */
  INVOICE_SYNC: 'invoice.sync',
  INVOICE_ISSUE: 'invoice.issue',
  INVOICE_VOID: 'invoice.void',
  INVOICE_VIEW: 'invoice.view',
  INVOICE_DOWNLOAD: 'invoice.download',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_REFUND: 'payment.refund',
  PAYMENT_VIEW: 'payment.view',
  PAYMENT_RECEIPT_DOWNLOAD: 'payment.receipt_download',
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

/** Invoice enums (spec §6.21, §5.5). */
export const INVOICE_STATUSES = Object.freeze([
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
] as const);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** appointment = the visit's invoice; supplementary = tests ordered after it was issued. */
export const INVOICE_KINDS = Object.freeze(['appointment', 'supplementary', 'manual'] as const);
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const INVOICE_LINE_KINDS = Object.freeze([
  'consultation',
  'lab_test',
  'procedure',
  'other',
] as const);
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];
/**
 * Kinds staff may add by hand: a consultation or procedure service, a lab test from the catalogue
 * (e.g. an outside sample billed at the desk – no lab order), or an 'other' line.
 */
export const INVOICE_STAFF_LINE_KINDS = Object.freeze([
  'consultation',
  'procedure',
  'lab_test',
  'other',
] as const);
/**
 * Where a line came from: `visit` = added by the system from the appointment or a lab order
 * (price and quantity fixed, only the discount can change, cannot be removed by hand);
 * `staff` = added at the desk.
 */
export const INVOICE_LINE_ORIGINS = Object.freeze(['visit', 'staff'] as const);
/** Invoices that are still owed (after issue, not fully paid). */
export const INVOICE_OPEN_STATUSES = Object.freeze(['issued', 'partially_paid'] as const);
export const BILLING_RULES = Object.freeze({
  maxQuantity: 999,
  maxLines: 50,
  maxTaxRateBps: 10_000,
  descriptionMax: 200,
  notesMax: 1000,
  reasonMinLength: 3,
  reasonMaxLength: 500,
  refundReasonMinLength: 10,
  referenceMax: 100,
});

/** Payment enums (spec §6.22): refunds are negative payments linked to the original. */
export const PAYMENT_KINDS = Object.freeze(['payment', 'refund'] as const);
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
/** Methods that need a reference (card slip, UPI transaction id, insurance claim number). */
export const PAYMENT_METHODS_NEEDING_REFERENCE = Object.freeze([
  'card',
  'upi',
  'insurance',
] as const);

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

/** Lab order enums (spec §6.20, §5.4 + 'draft'). */
export const LAB_ORDER_STATUSES = Object.freeze([
  'draft',
  'ordered',
  'sample_collected',
  'sample_rejected',
  'processing',
  'result_entered',
  'verified',
  'released',
  'cancelled',
] as const);
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];
export const LAB_ITEM_STATUSES = Object.freeze([
  'pending',
  'result_entered',
  'verified',
  'cancelled',
] as const);
export type LabItemStatus = (typeof LAB_ITEM_STATUSES)[number];
/** Result flags (spec §8.7); `na` = nothing to compare against. */
export const LAB_FLAGS = Object.freeze([
  'normal',
  'low',
  'high',
  'critical_low',
  'critical_high',
  'abnormal',
  'na',
] as const);
export type LabFlag = (typeof LAB_FLAGS)[number];
export const LAB_CRITICAL_FLAGS = Object.freeze([
  'critical_low',
  'critical_high',
] as const satisfies readonly LabFlag[]);
/** Lab priorities; sorting descending puts 'urgent' first (the worklist index relies on it). */
export const LAB_PRIORITIES = Object.freeze(['routine', 'urgent'] as const);
export type LabPriority = (typeof LAB_PRIORITIES)[number];

/**
 * Lab order rules (spec §6.20, §8.7): tests per order, text limits, the shortest reasons, and
 * the bounds for numeric results (anything beyond is a typing error, not a result).
 */
export const LAB_ORDER_RULES = Object.freeze({
  maxTests: 20,
  clinicalNotesMax: 500,
  reasonMinLength: 3,
  reasonMaxLength: 500,
  revisionReasonMinLength: 10,
  textValueMax: 500,
  remarksMax: 1000,
  numericValueMax: 1e7,
});
/** Statuses in which the ordering doctor may cancel the whole order (no sample held). */
export const LAB_ORDER_DOCTOR_CANCELLABLE = Object.freeze([
  'ordered',
  'sample_rejected',
] as const satisfies readonly LabOrderStatus[]);
/** Statuses in which a pending item may be cancelled (placed, results not yet complete). */
export const LAB_ITEM_CANCELLABLE_IN = Object.freeze([
  'ordered',
  'sample_collected',
  'sample_rejected',
  'processing',
] as const satisfies readonly LabOrderStatus[]);
/**
 * Orders whose results the ordering doctor reviews and acknowledges ("results to review"):
 * results entered (unverified), verified or released.
 */
export const LAB_REVIEWABLE_STATUSES = Object.freeze([
  'result_entered',
  'verified',
  'released',
] as const satisfies readonly LabOrderStatus[]);
/** Orders still in the lab: the turnaround job looks at these (spec §8.11). */
export const LAB_OPEN_STATUSES = Object.freeze([
  'ordered',
  'sample_collected',
  'sample_rejected',
  'processing',
  'result_entered',
  'verified',
] as const satisfies readonly LabOrderStatus[]);

/** Documents (spec §6.23, §7.16, §12.2). */
export const DOCUMENT_CATEGORIES = Object.freeze([
  'lab_report',
  'prescription',
  'visit_summary',
  'invoice',
  'referral',
  'imaging',
  'id_proof',
  'insurance',
  'other',
] as const);
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_LINK_TYPES = Object.freeze([
  'appointment',
  'encounter',
  'lab_order',
  'invoice',
  'followup_request',
] as const);
export type DocumentLinkType = (typeof DOCUMENT_LINK_TYPES)[number];
export const STORAGE_DRIVERS = Object.freeze(['local', 's3', 'cloudinary'] as const);
/** The only file types accepted, checked on the bytes (magic numbers), never the name. */
export const UPLOAD_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const);
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];
/**
 * Categories each role may upload (Phase 6). Lab techs upload lab reports for patients with a
 * lab order; patients upload for themselves only; admins upload nothing.
 */
export const DOCUMENT_UPLOAD_CATEGORIES: Readonly<
  Partial<Record<Role, readonly DocumentCategory[]>>
> = Object.freeze({
  doctor: ['referral', 'imaging', 'visit_summary', 'other'],
  receptionist: ['id_proof', 'insurance', 'referral', 'other'],
  labtech: ['lab_report'],
  patient: ['other', 'referral'],
});
/** Non-clinical categories reception always reads (invoices from Phase 7). */
export const RECEPTION_DOCUMENT_CATEGORIES = Object.freeze([
  'id_proof',
  'insurance',
  'invoice',
] as const satisfies readonly DocumentCategory[]);
/** Categories reception reads only when a receptionist or the patient uploaded them. */
export const RECEPTION_SHARED_CATEGORIES = Object.freeze([
  'referral',
  'other',
] as const satisfies readonly DocumentCategory[]);
export const DOCUMENT_RULES = Object.freeze({
  titleMax: 120,
  originalNameMax: 120,
  /** The uploader may delete their own upload for this long (spec §7.16). */
  uploaderDeleteHours: 24,
  deleteReasonMinLength: 5,
  deleteReasonMaxLength: 500,
  /** Uploads per user per hour (spec §10.3). */
  uploadsPerHour: 30,
});

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
  // Not in §16 (Phase 6): lab results are missing values the action needs; `details` lists them.
  RESULTS_INCOMPLETE: 'RESULTS_INCOMPLETE',
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',
  DISCOUNT_REQUIRES_ADMIN: 'DISCOUNT_REQUIRES_ADMIN',
  // Not in §16 (Phase 7): issuing an invoice that has no lines.
  INVOICE_EMPTY: 'INVOICE_EMPTY',
  // Not in §16 (Phase 7): voiding an invoice with money still paid on it (refund first).
  VOID_REQUIRES_REFUND: 'VOID_REQUIRES_REFUND',
  // Not in §16 (Phase 7): a refund larger than what is left of the payment.
  REFUND_EXCEEDS_PAYMENT: 'REFUND_EXCEEDS_PAYMENT',
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
  RESULTS_INCOMPLETE: 422,
  PAYMENT_EXCEEDS_BALANCE: 422,
  DISCOUNT_REQUIRES_ADMIN: 422,
  INVOICE_EMPTY: 422,
  VOID_REQUIRES_REFUND: 422,
  REFUND_EXCEEDS_PAYMENT: 422,
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
