import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * True when `key` is the configured KIOSK_KEY (queue board, spec §7.9). Compared in constant
 * time on hashes, so neither the key nor its length leaks through timing. Always false when no
 * key is configured (board switched off).
 */
export function isKioskKey(key: unknown): boolean {
  const expected = config.kiosk.key;
  if (!expected || typeof key !== 'string' || key.length === 0) return false;
  return timingSafeEqual(digest(key), digest(expected));
}
