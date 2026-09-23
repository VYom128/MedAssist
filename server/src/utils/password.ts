import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config/env.js';
import { COMMON_PASSWORDS_TEXT } from '../data/commonPasswords.js';

/** Hashes a password with bcrypt (BCRYPT_ROUNDS; 12 normally, 4 in tests). */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.auth.bcryptRounds);
}

/** Compares a password with a stored bcrypt hash. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: string | undefined;

/**
 * Spends the same time as a real comparison when there is no user to check, so login response
 * times do not reveal whether an email is registered.
 */
export async function fakePasswordCheck(password: string): Promise<false> {
  dummyHash ??= await bcrypt.hash('not-a-real-password', config.auth.bcryptRounds);
  await bcrypt.compare(password, dummyHash);
  return false;
}

// ---- Strength rules (spec §7.2) -----------------------------------------------------------

/** Loaded once at startup. */
const COMMON_PASSWORDS = new Set(
  COMMON_PASSWORDS_TEXT.split('\n')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean),
);

/** bcrypt ignores everything after 72 bytes, so longer passwords are rejected. */
export const MAX_PASSWORD_BYTES = 72;
export const PERSONAL_INFO_MESSAGE = 'Must not contain your name or email';
/** Name and email parts shorter than this are too generic to check (e.g. "Al"). */
const MIN_PERSONAL_PART = 3;

/** True if the password (case-insensitive) is one of the 1,000 most common. */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Checks a password against the policy: 8–72 characters, at least one letter and one number,
 * not one of the 1,000 most common, and not containing the email name or first name.
 * @returns the problems found (empty when the password is acceptable).
 */
export function checkPasswordStrength(
  password: string,
  personal: { email?: string; firstName?: string } = {},
): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push('Must be at least 8 characters');
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    problems.push(`Must be at most ${MAX_PASSWORD_BYTES} characters`);
  }
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    problems.push('Must contain a letter and a number');
  }
  if (isCommonPassword(password)) problems.push('This password is too common');

  const lower = password.toLowerCase();
  const parts = [personal.email?.split('@')[0], personal.firstName]
    .map((p) => p?.trim().toLowerCase())
    .filter((p): p is string => Boolean(p && p.length >= MIN_PERSONAL_PART));
  if (parts.some((p) => lower.includes(p))) problems.push(PERSONAL_INFO_MESSAGE);

  return problems;
}

/** Zod schema for the rules that need no personal data (the first problem is reported). */
export const passwordSchema = z.string().superRefine((password, ctx) => {
  const [problem] = checkPasswordStrength(password);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});
