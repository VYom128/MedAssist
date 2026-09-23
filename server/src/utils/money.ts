import { ApiError } from './ApiError.js';

/**
 * Money is stored and sent as integer paise (spec §3.7): never floats. These helpers convert at
 * the edges (seed data, reports) without floating-point drift.
 */

/** True when `value` is a non-negative safe integer. */
export function isPaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Throws 400 VALIDATION_ERROR unless `value` is a non-negative integer number of paise.
 * @param field Name reported in `details` (e.g. 'body.pricePaise').
 */
export function assertPaise(value: unknown, field = 'amount'): asserts value is number {
  if (!isPaise(value)) {
    throw ApiError.validation('Validation failed', [
      { field, message: 'Must be a whole number of paise (0 or more)' },
    ]);
  }
}

const DECIMAL = /^(\d+)(?:\.(\d*))?$/;

/**
 * Rupees → paise, rounding half-up on the third decimal. Works on the decimal digits, not on
 * `rupees * 100`, so 499.995 → 50000 (float maths gives 49999.49999…).
 * @param rupees A non-negative number or numeric string like "1250.5".
 * @throws RangeError for negative, non-finite or non-numeric input.
 */
export function rupeesToPaise(rupees: number | string): number {
  const text = typeof rupees === 'number' ? numberToPlainString(rupees) : rupees.trim();
  const match = DECIMAL.exec(text);
  if (!match) throw new RangeError(`Not a valid rupee amount: ${String(rupees)}`);
  const whole = match[1]!;
  const fraction = (match[2] ?? '').padEnd(3, '0');
  let paise = Number(whole) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) paise += 1;
  if (!Number.isSafeInteger(paise)) throw new RangeError('Rupee amount is too large');
  return paise;
}

/** Paise → rupees as a number (e.g. 125050 → 1250.5). Display formatting is the client's job. */
export function paiseToRupees(paise: number): number {
  assertPaise(paise);
  return paise / 100;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Not a valid rupee amount: ${n}`);
  const text = String(n);
  // Tiny or huge numbers print in exponent form (1e-7, 1e+21): not meaningful rupee amounts.
  if (/e/i.test(text)) throw new RangeError(`Not a valid rupee amount: ${n}`);
  return text;
}
