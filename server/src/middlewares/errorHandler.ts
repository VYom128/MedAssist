import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES } from '../config/constants.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger, serializeError } from '../utils/logger.js';

interface BodyParserError extends Error {
  type?: string;
}

interface MongoServerErrorLike extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}

/** Maps any thrown value to an ApiError. Unknown errors become INTERNAL_ERROR. */
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.validation(
      'Validation failed',
      err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      'Validation failed',
      Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid ${err.path}`);
  }

  if (err instanceof Error) {
    const bodyErr = err as BodyParserError;
    if (bodyErr.type === 'entity.parse.failed') {
      return ApiError.badRequest('Malformed JSON');
    }
    if (bodyErr.type === 'entity.too.large') {
      return new ApiError(413, 'Request body is too large', ERROR_CODES.PAYLOAD_TOO_LARGE);
    }

    const mongoErr = err as MongoServerErrorLike;
    if (mongoErr.code === 11000 && /^Mongo/.test(mongoErr.name)) {
      // Name the field(s), never echo the duplicate values (may be patient data).
      const fields = Object.keys(mongoErr.keyValue ?? mongoErr.keyPattern ?? {});
      const label = fields.length > 0 ? fields.join(', ') : 'a unique field';
      return ApiError.conflict(`Duplicate value for ${label}`, { fields });
    }

    // Unknown error: the real message is only shown in development.
    if (config.isDev) return ApiError.internal(err.message);
  }

  return ApiError.internal();
}

/**
 * Central error handler. Always responds with
 * `{ success: false, message, error: { code, details? }, requestId }` (+ `stack` in development).
 * Logs 5xx at error level (with stack) and 4xx at warn level. Never logs the request body.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = toApiError(err);
  const original = err instanceof Error ? err : new Error(String(err));

  if (apiError.statusCode >= 500) {
    logger.error(
      {
        requestId: req.id,
        code: apiError.code,
        err: serializeError(err),
      },
      'Request failed',
    );
  } else {
    logger.warn(
      { requestId: req.id, code: apiError.code, statusCode: apiError.statusCode },
      apiError.message,
    );
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    error: {
      code: apiError.code,
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
    },
    requestId: req.id,
    ...(config.isDev ? { stack: original.stack } : {}),
  });
};
