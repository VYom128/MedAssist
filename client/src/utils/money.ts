/**
 * Money is integer paise everywhere (spec §3.7); people type and read rupees. These helpers
 * convert without floating-point drift (they work on the decimal digits, like the server).
 */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

/** 125050 → "₹1,250.50" (Indian digit grouping: ₹1,25,000.00). */
export function formatINR(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '—';
  return inr.format(paise / 100);
}

const DECIMAL = /^(\d+)(?:\.(\d*))?$/;

/**
 * What someone typed in rupees → paise, rounding half-up on the third decimal
 * ("499.995" → 50000). Commas and spaces are ignored.
 * @returns null for empty input, NaN for input that is not an amount.
 */
export function rupeesToPaise(rupees: string | number): number | null {
  const text = String(rupees).replace(/[,\s₹]/g, '');
  if (text === '') return null;
  const match = DECIMAL.exec(text);
  if (!match) return Number.NaN;
  const fraction = (match[2] ?? '').padEnd(3, '0');
  let paise = Number(match[1]) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) paise += 1;
  return Number.isSafeInteger(paise) ? paise : Number.NaN;
}

/** Paise → rupees for a form input: 50000 → "500", 125050 → "1250.50"; null → "". */
export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return '';
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}

/** Basis points → percent (1800 → 18). */
export const bpsToPercent = (bps: number) => bps / 100;

/** Percent → basis points (18.5 → 1850), rounded to a whole basis point. */
export const percentToBps = (percent: number) => Math.round(percent * 100);

/** "18%" / "12.5%" from basis points. */
export const formatPercentFromBps = (bps: number) =>
  `${Number((bps / 100).toFixed(2)).toString()}%`;
