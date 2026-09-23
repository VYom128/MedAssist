import { rateLimit, type Options } from 'express-rate-limit';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Builds a per-IP rate limiter whose 429 response goes through errorHandler
 * (standard error format, code RATE_LIMITED).
 */
export function createRateLimiter(options: Partial<Options> = {}) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(ApiError.tooManyRequests()),
    ...options,
  });
}

/** Global API limiter: 300 requests / 15 min per IP (configurable via env). Off in tests. */
export const apiLimiter = createRateLimiter({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  skip: () => config.isTest,
});
