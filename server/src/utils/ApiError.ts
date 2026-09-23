import { ERROR_CODES, type ErrorCode } from '../config/constants.js';

/**
 * Expected (operational) error. Throw it anywhere; errorHandler turns it into
 * `{ success: false, message, error: { code, details }, requestId }`.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /** Operational errors are safe to show to the client; anything else becomes INTERNAL_ERROR. */
  readonly isOperational = true;

  /**
   * @param statusCode HTTP status code.
   * @param message Human-readable message sent to the client.
   * @param code Error code from ERROR_CODES (spec §16).
   * @param details Optional extra data (e.g. per-field validation errors). Never include patient data.
   */
  constructor(statusCode: number, message: string, code: ErrorCode, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  /** 400 BAD_REQUEST – malformed request or invalid id. */
  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(400, message, ERROR_CODES.BAD_REQUEST, details);
  }

  /** 400 VALIDATION_ERROR – input failed validation; `details` lists the fields. */
  static validation(message = 'Validation failed', details?: unknown) {
    return new ApiError(400, message, ERROR_CODES.VALIDATION_ERROR, details);
  }

  /** 401 UNAUTHORIZED – not logged in or invalid token. */
  static unauthorized(message = 'Authentication required', details?: unknown) {
    return new ApiError(401, message, ERROR_CODES.UNAUTHORIZED, details);
  }

  /** 403 FORBIDDEN – role not allowed. */
  static forbidden(
    message = 'You do not have permission to perform this action',
    details?: unknown,
  ) {
    return new ApiError(403, message, ERROR_CODES.FORBIDDEN, details);
  }

  /** 404 NOT_FOUND – missing or not visible to the caller. */
  static notFound(message = 'Resource not found', details?: unknown) {
    return new ApiError(404, message, ERROR_CODES.NOT_FOUND, details);
  }

  /** 409 CONFLICT – duplicate or stale version. */
  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError(409, message, ERROR_CODES.CONFLICT, details);
  }

  /** 422 BUSINESS_RULE_VIOLATION – valid input that breaks a business rule. */
  static unprocessable(message = 'Request violates a business rule', details?: unknown) {
    return new ApiError(422, message, ERROR_CODES.BUSINESS_RULE_VIOLATION, details);
  }

  /** 429 RATE_LIMITED – too many requests. */
  static tooManyRequests(message = 'Too many requests, please try again later', details?: unknown) {
    return new ApiError(429, message, ERROR_CODES.RATE_LIMITED, details);
  }

  /** 500 INTERNAL_ERROR – unexpected failure; the message is always generic. */
  static internal(message = 'Something went wrong', details?: unknown) {
    return new ApiError(500, message, ERROR_CODES.INTERNAL_ERROR, details);
  }
}
