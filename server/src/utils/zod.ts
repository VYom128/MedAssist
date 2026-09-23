import { isValidObjectId } from 'mongoose';
import { z } from 'zod';

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
