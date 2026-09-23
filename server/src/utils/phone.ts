import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { PATIENT_RULES } from '../config/constants.js';

/**
 * Phone numbers are stored in E.164 ('+919876543210'). Input may be in any common format:
 * '+91 98765 43210', '098765-43210', '9876543210' (numbers without a country code are read as
 * Indian, spec §20).
 */

const DEFAULT_COUNTRY = PATIENT_RULES.defaultPhoneCountry as CountryCode;

/** Thrown by `normalisePhone` for input that is not a valid phone number. */
export class InvalidPhoneError extends RangeError {
  constructor() {
    super('Enter a valid phone number');
    this.name = 'InvalidPhoneError';
  }
}

/** E.164 form of `input`, or null if it is not a valid phone number. */
export function tryNormalisePhone(
  input: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/**
 * E.164 form of `input` ('9876543210' → '+919876543210').
 * @throws InvalidPhoneError if it is not a valid phone number.
 */
export function normalisePhone(
  input: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): string {
  const e164 = tryNormalisePhone(input, defaultCountry);
  if (!e164) throw new InvalidPhoneError();
  return e164;
}

/** Display form of a stored number ('+919876543210' → '+91 98765 43210'). */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
