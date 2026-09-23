import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * Phone numbers (mirrors server/src/utils/phone.ts): any common format in, E.164 out. Numbers
 * without a country code are Indian (+91).
 */

/** '098765 43210' → '+919876543210', or null if it is not a valid number. */
export function normalisePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), 'IN');
  return parsed?.isValid() ? parsed.number : null;
}

/** '+919876543210' → '+91 98765 43210' (unchanged if it cannot be parsed). */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  return parsePhoneNumberFromString(value)?.formatInternational() ?? value;
}

/** The starting value of phone inputs: Indian numbers are the common case. */
export const PHONE_PREFIX = '+91 ';

/** True when the input is empty or only the default prefix. */
export const isBlankPhone = (value: string) => value.trim() === '' || value.trim() === '+91';
