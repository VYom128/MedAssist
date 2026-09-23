import { ERROR_CODES, type ErrorCode } from '../config/constants.js';

/** Operational error. Thrown anywhere; turned into the standard error response by errorHandler. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = ERROR_CODES[code];
    this.details = details;
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError('BAD_REQUEST', message, details);
  }

  static validation(details: unknown, message = 'Validation failed') {
    return new ApiError('VALIDATION_ERROR', message, details);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError('NOT_FOUND', message);
  }

  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError('CONFLICT', message, details);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError('FORBIDDEN', message);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError('UNAUTHORIZED', message);
  }

  static internal(message = 'Something went wrong') {
    return new ApiError('INTERNAL_ERROR', message);
  }
}
