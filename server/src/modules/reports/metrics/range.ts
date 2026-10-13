import { addDaysToDate, daysBetween, startOfClinicDay } from '../../../utils/dates.js';

/**
 * A range of clinic dates (spec §14, Phase 10): `from`–`to` inclusive ('YYYY-MM-DD' in the
 * clinic timezone) as the UTC instants `[start, end)` – `end` is the next clinic midnight, so an
 * entry at 23:59:59 clinic time on `to` is inside and one at 00:00 the next day is not.
 */
export interface ClinicRange {
  from: string;
  to: string;
  start: Date;
  end: Date;
  timezone: string;
}

export function clinicRange(from: string, to: string, timezone: string): ClinicRange {
  return {
    from,
    to,
    timezone,
    start: startOfClinicDay(from, timezone),
    end: startOfClinicDay(addDaysToDate(to, 1), timezone),
  };
}

/** Number of clinic days in the range (both ends included). */
export const rangeDays = (r: { from: string; to: string }) => daysBetween(r.from, r.to) + 1;

/** Every clinic date of the range, in order. */
export function datesIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDate(d, 1)) out.push(d);
  return out;
}

/** Every month 'YYYY-MM' the range touches, in order. */
export function monthsIn(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) return out;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/** `$match` on an instant field inside the range. */
export const inRange = (field: string, r: ClinicRange) => ({
  [field]: { $gte: r.start, $lt: r.end },
});

/** Aggregation key: the clinic date ('YYYY-MM-DD') of an instant field. */
export const clinicDayKey = (field: string, timezone: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone },
});

/** Aggregation key: the clinic month ('YYYY-MM') of an instant field. */
export const clinicMonthKey = (field: string, timezone: string) => ({
  $dateToString: { format: '%Y-%m', date: `$${field}`, timezone },
});

/**
 * The p-th percentile (0–100) of numbers, by linear interpolation between closest ranks (the
 * common spreadsheet definition); null for no values.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** A ratio rounded to 4 decimals, or null when the denominator is 0. */
export const ratio = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 10_000) / 10_000 : null;
