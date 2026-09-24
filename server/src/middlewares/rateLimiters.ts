import type { Request } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { ROLES } from '../config/constants.js';
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

const MINUTE = 60_000;

/** Client IP (IPv6 grouped to /56 so one host cannot rotate addresses) plus the submitted email. */
export function ipAndEmailKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
}

/** Login: 10 attempts / 15 min per IP + email (spec §10.3). Account lockout is separate (§5.8). */
export const createLoginLimiter = (options: Partial<Options> = {}) =>
  createRateLimiter({ windowMs: 15 * MINUTE, limit: 10, keyGenerator: ipAndEmailKey, ...options });

/** Register: 5 / hour per IP (spec §10.3). */
export const createRegisterLimiter = (options: Partial<Options> = {}) =>
  createRateLimiter({ windowMs: 60 * MINUTE, limit: 5, ...options });

/** Forgot / reset password: 5 / hour per IP (not in §10.3; limits reset-email spam). */
export const createPasswordResetLimiter = (options: Partial<Options> = {}) =>
  createRateLimiter({ windowMs: 60 * MINUTE, limit: 5, ...options });

/**
 * Patient bookings and reschedules: 20 / hour per user (Phase 4). Staff are not limited here.
 * Mount after `authenticate`.
 */
export const createPatientBookingLimiter = (options: Partial<Options> = {}) =>
  createRateLimiter({
    windowMs: 60 * MINUTE,
    limit: 20,
    keyGenerator: (req) => `user:${req.user?.id ?? ''}`,
    ...options,
    skip: (req, res) => req.user?.role !== ROLES.PATIENT || (options.skip?.(req, res) ?? false),
  });

/** Kiosk queue board: 60 / minute per IP (a board polls every 15 s; limits key guessing). */
export const createBoardLimiter = (options: Partial<Options> = {}) =>
  createRateLimiter({ windowMs: MINUTE, limit: 60, ...options });

// App instances are off in tests; tests build their own with the factories above.
const skipInTest = () => config.isTest;
export const loginLimiter = createLoginLimiter({ skip: skipInTest });
export const registerLimiter = createRegisterLimiter({ skip: skipInTest });
/** Separate budgets so asking for a link does not use up the attempts to set the password. */
export const forgotPasswordLimiter = createPasswordResetLimiter({ skip: skipInTest });
export const resetPasswordLimiter = createPasswordResetLimiter({ skip: skipInTest });
export const patientBookingLimiter = createPatientBookingLimiter({ skip: skipInTest });
export const boardLimiter = createBoardLimiter({ skip: skipInTest });
