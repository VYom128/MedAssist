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
 * Roles an admin can create through POST /users (staff). Patients sign up or are invited
 * (Phase 3). Phase 2 adds the doctor profile for doctor accounts.
 */
export const ADMIN_CREATABLE_ROLES = STAFF_ROLES;

/** Patient portal link state (spec §4.4). Set from Phase 3. */
export const PATIENT_LINK_STATUSES = Object.freeze(['linked', 'pending_verification'] as const);

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
} as const);
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
/** The same user reading the same record within this window produces one audit entry (§10.4). */
export const AUDIT_READ_DEBOUNCE_MS = 5 * 60_000;
/** prevHash of the first audit entry. */
export const AUDIT_GENESIS_HASH = 'GENESIS';

/** Scopes for canAccessPatient (spec §2.3). */
export const PATIENT_ACCESS_SCOPES = Object.freeze([
  'demographics',
  'clinical',
  'billing',
  'lab',
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
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  PATIENT_DOUBLE_BOOKED: 'PATIENT_DOUBLE_BOOKED',
  DOCTOR_UNAVAILABLE: 'DOCTOR_UNAVAILABLE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  RECORD_LOCKED: 'RECORD_LOCKED',
  // Not in §16: generic 422 for business rules without a specific code (see ROADMAP Phase 0 notes).
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  CANCELLATION_WINDOW_PASSED: 'CANCELLATION_WINDOW_PASSED',
  BOOKING_LIMIT_REACHED: 'BOOKING_LIMIT_REACHED',
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
  SLOT_UNAVAILABLE: 409,
  PATIENT_DOUBLE_BOOKED: 409,
  DOCTOR_UNAVAILABLE: 409,
  INVALID_STATUS_TRANSITION: 409,
  RECORD_LOCKED: 409,
  BUSINESS_RULE_VIOLATION: 422,
  CANCELLATION_WINDOW_PASSED: 422,
  BOOKING_LIMIT_REACHED: 422,
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
