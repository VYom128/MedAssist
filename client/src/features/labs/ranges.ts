import type { LabFlag } from '../../constants/catalog';

const LAB_CRITICAL_FLAGS: readonly LabFlag[] = ['critical_low', 'critical_high'];

/**
 * Reference ranges and result flags (spec §8.7) – a copy of server/src/modules/labOrders/
 * ranges.ts for the live flag preview while typing. The server computes the stored flag; keep
 * both files in step (tests/labRanges.test.ts runs the same cases).
 */

export interface RangeLike {
  gender?: string | null;
  ageMinYears?: number | null;
  ageMaxYears?: number | null;
  low?: number | null;
  high?: number | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  text?: string | null;
}

export interface ParameterLike {
  key: string;
  valueType: string;
  unit?: string | null;
  options?: readonly string[] | null;
  abnormalOptions?: readonly string[] | null;
  ranges?: readonly RangeLike[] | null;
}

export interface Subject {
  /** The patient's sex: male/female ranges apply to those; anything else uses 'any' ranges. */
  gender?: string | null;
  /** Whole years at sample collection; unknown → only ranges without age bounds apply. */
  ageYears?: number | null;
}

const has = (n: number | null | undefined): n is number => typeof n === 'number';

function coversAge(r: RangeLike, ageYears: number | null | undefined): boolean {
  if (!has(ageYears)) return !has(r.ageMinYears) && !has(r.ageMaxYears);
  return (r.ageMinYears ?? 0) <= ageYears && ageYears <= (r.ageMaxYears ?? Infinity);
}

const bandWidth = (r: RangeLike) => (r.ageMaxYears ?? Infinity) - (r.ageMinYears ?? 0);

/**
 * The reference range for a patient: among ranges whose age band contains `ageYears` (both ends
 * inclusive, missing ends open), a range for the patient's own sex beats an 'any' range, and a
 * narrower age band beats a wider one. null when none applies.
 */
export function selectRange(parameter: ParameterLike, { gender, ageYears }: Subject) {
  const ranges = (parameter.ranges ?? []).filter((r) => coversAge(r, ageYears));
  const specific = gender === 'male' || gender === 'female' ? gender : null;
  const pick = (g: string) =>
    ranges
      .filter((r) => (r.gender ?? 'any') === g)
      .sort((a, b) => bandWidth(a) - bandWidth(b))[0] ?? null;
  return (specific ? pick(specific) : null) ?? pick('any');
}

/**
 * The flag of one value (spec §8.7):
 * - number: below criticalLow → critical_low; below low → low; above criticalHigh →
 *   critical_high; above high → high; else normal (bounds themselves are in range). No range, or
 *   a range with only a reference text → na.
 * - option: 'abnormal' if the catalogue marks that option abnormal, else na.
 * - text, or no value: na.
 */
export function computeFlag(
  value: unknown,
  parameter: ParameterLike,
  range: RangeLike | null,
): LabFlag {
  if (value === null || value === undefined || value === '') return 'na';
  if (parameter.valueType === 'option') {
    return (parameter.abnormalOptions ?? []).includes(String(value)) ? 'abnormal' : 'na';
  }
  if (parameter.valueType !== 'number') return 'na';
  if (typeof value !== 'number' || !Number.isFinite(value) || !range) return 'na';
  const { low, high, criticalLow, criticalHigh } = range;
  if (![low, high, criticalLow, criticalHigh].some(has)) return 'na';
  if (has(criticalLow) && value < criticalLow) return 'critical_low';
  if (has(low) && value < low) return 'low';
  if (has(criticalHigh) && value > criticalHigh) return 'critical_high';
  if (has(high) && value > high) return 'high';
  return 'normal';
}

export const isCriticalFlag = (flag: string | null | undefined) =>
  (LAB_CRITICAL_FLAGS as readonly string[]).includes(flag ?? '');

/**
 * The reference shown next to a value: the range's text, else 'low–high unit', '< high unit'
 * or '> low unit'; options list the normal ones; null when there is nothing to show.
 */
export function referenceText(parameter: ParameterLike, range: RangeLike | null): string | null {
  if (parameter.valueType === 'option') {
    const abnormal = parameter.abnormalOptions ?? [];
    if (abnormal.length === 0) return null;
    const normal = (parameter.options ?? []).filter((o) => !abnormal.includes(o));
    return normal.length > 0 ? normal.join(' / ') : null;
  }
  if (!range) return null;
  if (range.text) return range.text;
  const unit = parameter.unit ? ` ${parameter.unit}` : '';
  if (has(range.low) && has(range.high)) return `${range.low}–${range.high}${unit}`;
  if (has(range.high)) return `< ${range.high}${unit}`;
  if (has(range.low)) return `> ${range.low}${unit}`;
  return null;
}
