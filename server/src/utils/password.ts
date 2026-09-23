import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

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
