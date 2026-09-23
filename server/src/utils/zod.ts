import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { isValidDateOnly, isValidTimeHHmm, isValidTimezone } from './dates.js';
import { parseSort, type SortSpec } from './pagination.js';

/** A 24-character hex MongoDB ObjectId (spec §7.1: invalid ids → 400). */
export const objectId = z
  .string()
  .trim()
  .refine((v) => /^[a-f0-9]{24}$/i.test(v) && isValidObjectId(v), 'Invalid id');

/** `{ id }` path params. */
export const idParams = z.object({ id: objectId });

/** E.164-ish phone number: optional +, 10–15 digits (spaces and dashes stripped). */
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number'));

/** Person name part: trimmed, 1–50 chars. */
export const namePart = z.string().trim().min(1, 'Required').max(50, 'At most 50 characters');

/** Lower-cased, trimmed email. */
export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

/**
 * `?sort=` query param restricted to `allowed` fields (spec §7.1), parsed into a Mongo sort
 * object. Missing → `fallback`.
 */
export function sortQuery(allowed: readonly string[], fallback: SortSpec) {
  return z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value, ctx) => {
      const sort = parseSort(value, allowed, fallback);
      if (!sort) {
        ctx.addIssue({
          code: 'custom',
          message: `Sort by ${allowed.join(', ')} (prefix with - for descending)`,
        });
        return z.NEVER;
      }
      return sort;
    });
}

/** Money in integer paise (spec §3.7): 0 or more, no fractions. */
export const paise = z
  .number()
  .int('Must be a whole number of paise')
  .min(0, 'Must be 0 or more')
  .max(Number.MAX_SAFE_INTEGER);

/** 24-hour clock time 'HH:mm' in the clinic timezone. */
export const timeHHmm = z.string().trim().refine(isValidTimeHHmm, 'Use HH:mm (24-hour)');

/** Calendar date 'YYYY-MM-DD'. */
export const dateOnly = z.string().trim().refine(isValidDateOnly, 'Use a real date as YYYY-MM-DD');

/** IANA timezone name ('Asia/Kolkata'). */
export const timezone = z.string().trim().refine(isValidTimezone, 'Unknown timezone');

/** `?flag=true|false` query param → boolean. */
export const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** `?page` / `?limit` (spec §7.1). */
export const paginationQuery = {
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
};

/** Optional free text: trimmed, max `max` chars; an empty string clears the field (null). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
