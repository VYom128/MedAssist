import {
  computeFlag,
  isCriticalFlag,
  referenceText,
  selectRange,
  type ParameterLike,
} from '../../src/modules/labOrders/ranges.js';
import { parameterIssues } from '../../src/modules/labTests/validation.js';

/** Haemoglobin with sex- and age-specific ranges plus an 'any' fallback for children. */
const hb: ParameterLike = {
  key: 'hb',
  valueType: 'number',
  unit: 'g/dL',
  ranges: [
    { gender: 'male', ageMinYears: 18, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
    { gender: 'female', ageMinYears: 18, low: 12, high: 15.5, criticalLow: 7, criticalHigh: 20 },
    { gender: 'any', ageMaxYears: 17, low: 11, high: 16 },
    { gender: 'any', ageMinYears: 18, low: 12, high: 17 },
  ],
};

describe('selectRange (spec §8.7)', () => {
  it('prefers a range for the patient’s sex over an any-sex range', () => {
    expect(selectRange(hb, { gender: 'male', ageYears: 40 })).toMatchObject({ low: 13, high: 17 });
    expect(selectRange(hb, { gender: 'female', ageYears: 40 })).toMatchObject({ low: 12 });
  });

  it('uses the any-sex range for other/unknown sex and when no sex-specific band applies', () => {
    expect(selectRange(hb, { gender: 'other', ageYears: 40 })).toMatchObject({ high: 17 });
    expect(selectRange(hb, { gender: 'unknown', ageYears: 40 })).toMatchObject({ gender: 'any' });
    expect(selectRange(hb, { gender: 'male', ageYears: 10 })).toMatchObject({ low: 11, high: 16 });
  });

  it('age bands include both ends', () => {
    expect(selectRange(hb, { gender: 'male', ageYears: 17 })).toMatchObject({ low: 11 });
    expect(selectRange(hb, { gender: 'male', ageYears: 18 })).toMatchObject({ low: 13 });
    expect(selectRange(hb, { gender: 'male', ageYears: 0 })).toMatchObject({ low: 11 });
  });

  it('a narrower age band wins over a wider one for the same sex', () => {
    const p: ParameterLike = {
      key: 'x',
      valueType: 'number',
      ranges: [
        { gender: 'any', low: 1, high: 10 },
        { gender: 'any', ageMinYears: 60, ageMaxYears: 80, low: 2, high: 8 },
      ],
    };
    expect(selectRange(p, { ageYears: 70 })).toMatchObject({ low: 2 });
    expect(selectRange(p, { ageYears: 30 })).toMatchObject({ low: 1 });
  });

  it('null when nothing applies; unknown age only matches unbounded ranges', () => {
    expect(selectRange({ key: 'x', valueType: 'number', ranges: [] }, { ageYears: 30 })).toBeNull();
    expect(selectRange({ key: 'x', valueType: 'text' }, { ageYears: 30 })).toBeNull();
    expect(selectRange(hb, { gender: 'male', ageYears: null })).toBeNull();
    const open: ParameterLike = { key: 'x', valueType: 'number', ranges: [{ low: 1, high: 2 }] };
    expect(selectRange(open, { gender: 'female' })).toMatchObject({ low: 1 });
  });
});

describe('computeFlag (spec §8.7)', () => {
  const adultMale = selectRange(hb, { gender: 'male', ageYears: 40 });
  const flag = (v: unknown) => computeFlag(v, hb, adultMale);

  it('numbers: critical_low < low ≤ normal ≤ high < critical_high, bounds are in range', () => {
    expect(flag(6.9)).toBe('critical_low');
    expect(flag(7)).toBe('low');
    expect(flag(12.9)).toBe('low');
    expect(flag(13)).toBe('normal');
    expect(flag(15)).toBe('normal');
    expect(flag(17)).toBe('normal');
    expect(flag(17.1)).toBe('high');
    expect(flag(20)).toBe('high');
    expect(flag(20.1)).toBe('critical_high');
  });

  it('works with one-sided and critical-only ranges', () => {
    const p: ParameterLike = { key: 'chol', valueType: 'number' };
    expect(computeFlag(250, p, { high: 200 })).toBe('high');
    expect(computeFlag(150, p, { high: 200 })).toBe('normal');
    expect(computeFlag(1, p, { low: 3 })).toBe('low');
    expect(computeFlag(1, p, { criticalLow: 2 })).toBe('critical_low');
    expect(computeFlag(3, p, { criticalLow: 2 })).toBe('normal');
  });

  it('na without a range, with a text-only range, or without a usable number', () => {
    const p: ParameterLike = { key: 'x', valueType: 'number' };
    expect(computeFlag(5, p, null)).toBe('na');
    expect(computeFlag(5, p, { text: 'See comment' })).toBe('na');
    expect(flag(null)).toBe('na');
    expect(flag(undefined)).toBe('na');
    expect(flag('')).toBe('na');
    expect(flag('13')).toBe('na');
    expect(flag(Number.NaN)).toBe('na');
  });

  it('options: abnormal only when the catalogue marks the option abnormal, else na', () => {
    const ns1: ParameterLike = {
      key: 'ns1',
      valueType: 'option',
      options: ['Negative', 'Positive', 'Equivocal'],
      abnormalOptions: ['Positive'],
    };
    expect(computeFlag('Positive', ns1, null)).toBe('abnormal');
    expect(computeFlag('Negative', ns1, null)).toBe('na');
    expect(computeFlag('Equivocal', ns1, null)).toBe('na');
    const unmarked = { ...ns1, abnormalOptions: undefined };
    expect(computeFlag('Positive', unmarked, null)).toBe('na');
  });

  it('text values are always na', () => {
    expect(computeFlag('Clear, pale yellow', { key: 'c', valueType: 'text' }, null)).toBe('na');
  });

  it('isCriticalFlag', () => {
    expect(isCriticalFlag('critical_low')).toBe(true);
    expect(isCriticalFlag('critical_high')).toBe(true);
    expect(isCriticalFlag('high')).toBe(false);
    expect(isCriticalFlag(null)).toBe(false);
  });
});

describe('referenceText', () => {
  it('uses the range text, else the bounds with the unit', () => {
    expect(referenceText(hb, { low: 13, high: 17 })).toBe('13–17 g/dL');
    expect(referenceText(hb, { high: 200 })).toBe('< 200 g/dL');
    expect(referenceText(hb, { low: 3 })).toBe('> 3 g/dL');
    expect(referenceText(hb, { high: 200, text: '< 200 desirable' })).toBe('< 200 desirable');
    expect(referenceText(hb, null)).toBeNull();
    expect(referenceText({ key: 'x', valueType: 'number' }, { criticalLow: 1 })).toBeNull();
  });

  it('options list the normal ones when some are marked abnormal', () => {
    const p: ParameterLike = {
      key: 'ns1',
      valueType: 'option',
      options: ['Negative', 'Positive'],
      abnormalOptions: ['Positive'],
    };
    expect(referenceText(p, null)).toBe('Negative');
    expect(referenceText({ ...p, abnormalOptions: [] }, null)).toBeNull();
  });
});

describe('abnormalOptions in the catalogue', () => {
  const option = (abnormalOptions: string[], valueType: 'option' | 'text' = 'option') => ({
    key: 'ns1',
    name: 'NS1',
    valueType,
    ...(valueType === 'option' ? { options: ['Negative', 'Positive'] } : {}),
    abnormalOptions,
  });
  const messages = (p: Parameters<typeof parameterIssues>[0]) =>
    parameterIssues(p).map((i) => i.message);

  it('must be options of an option parameter, leaving at least one normal', () => {
    expect(messages([option(['Positive'])])).toEqual([]);
    expect(messages([option(['Weak'])])).toEqual(['Abnormal options must be among the options']);
    expect(messages([option(['Negative', 'Positive'])])).toEqual([
      'At least one option must be normal',
    ]);
    expect(messages([option(['Positive'], 'text')])).toEqual([
      'Only option parameters have abnormal options',
    ]);
  });
});
