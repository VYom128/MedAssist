import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

interface MongoServerErrorLike extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
}

/** Maps any thrown value to an ApiError. Unknown errors become INTERNAL_ERROR. */
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.validation(
      'Validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      'Validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for ${err.path}`);
  }

  if (err instanceof Error) {
    const bodyErr = err as BodyParserError;
    if (bodyErr.type === 'entity.parse.failed') {
      return ApiError.badRequest('Malformed JSON in request body');
    }
    if (bodyErr.type === 'entity.too.large') {
      return new ApiError(413, 'Request body is too large', ERROR_CODES.PAYLOAD_TOO_LARGE);
    }

    const mongoErr = err as MongoServerErrorLike;
    if (mongoErr.name === 'MongoServerError' && mongoErr.code === 11000) {
      // Only field names – never echo the duplicate values (may be patient data).
      return ApiError.conflict('Duplicate value', { fields: Object.keys(mongoErr.keyValue ?? {}) });
    }
  }

  return ApiError.internal();
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = toApiError(err);

  if (apiError.statusCode >= 500) {
    // Log the original error (message + stack), not the request body.
    logger.error({ err, requestId: req.id }, 'Unhandled error');
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    error: {
      code: apiError.code,
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
    },
    requestId: req.id,
  });
};
