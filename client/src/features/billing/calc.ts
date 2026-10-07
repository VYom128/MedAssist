/**
 * The server's billing maths (spec §8.9), for the live preview only – the server always
 * recomputes, and its totals are what the page shows once saved. Integer paise; tax rounded
 * half-up per line (BigInt, like the server).
 */

export interface PreviewLine {
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxRateBps: number;
}

export interface PreviewAmounts {
  grossPaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** One line's amounts, or null while the input is incomplete or invalid. */
export function previewLine(l: PreviewLine): PreviewAmounts | null {
  if (![l.quantity, l.unitPricePaise, l.discountPaise, l.taxRateBps].every(whole)) return null;
  if (l.quantity < 1) return null;
  const gross = BigInt(l.quantity) * BigInt(l.unitPricePaise);
  const discount = BigInt(l.discountPaise);
  if (discount > gross) return null;
  const taxable = gross - discount;
  const tax = (taxable * BigInt(l.taxRateBps) + 5000n) / 10000n;
  return {
    grossPaise: Number(gross),
    taxPaise: Number(tax),
    lineTotalPaise: Number(taxable + tax),
  };
}

export interface PreviewTotals {
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  totalPaise: number;
}

/** Totals of the lines, or null if any line is invalid. */
export function previewTotals(lines: readonly PreviewLine[]): PreviewTotals | null {
  const totals = { subtotalPaise: 0, discountTotalPaise: 0, taxTotalPaise: 0, totalPaise: 0 };
  for (const l of lines) {
    const a = previewLine(l);
    if (!a) return null;
    totals.subtotalPaise += a.grossPaise;
    totals.discountTotalPaise += l.discountPaise;
    totals.taxTotalPaise += a.taxPaise;
    totals.totalPaise += a.lineTotalPaise;
  }
  return totals;
}

/** A percentage of an amount as whole paise, half-up (12.5 % of ₹99.99 → 1250). */
export function percentOfPaise(paise: number, percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return Number.NaN;
  // Work in hundredths of a percent to stay in integers.
  const hundredths = Math.round(percent * 100);
  return Number((BigInt(paise) * BigInt(hundredths) + 5000n) / 10000n);
}

/** Discount over gross, in percent (for the "above the limit" hint). */
export const discountPercentOf = (t: PreviewTotals) =>
  t.subtotalPaise === 0 ? 0 : (t.discountTotalPaise * 100) / t.subtotalPaise;
