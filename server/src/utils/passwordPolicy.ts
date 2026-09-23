import { z } from 'zod';
import { COMMON_PASSWORDS_TEXT } from '../data/commonPasswords.js';

const COMMON_PASSWORDS = new Set(
  COMMON_PASSWORDS_TEXT.split('\n')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean),
);

/** True if the password (case-insensitive) is one of the 1,000 most common. */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Password policy (spec §7.2): 8–72 characters (bcrypt ignores bytes after 72), at least one
 * letter and one number, and not one of the 1,000 most common passwords.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Must be at most 72 characters')
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), 'Must contain a letter and a number')
  .refine((p) => !isCommonPassword(p), 'This password is too common');
