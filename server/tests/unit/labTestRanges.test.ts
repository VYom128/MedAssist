import { parameterIssues, type ParameterInput } from '../../src/modules/labTests/validation.js';

const num = (ranges: ParameterInput['ranges'], key = 'hb'): ParameterInput => ({
  key,
  name: 'Haemoglobin',
  unit: 'g/dL',
  valueType: 'number',
  ranges,
});
const r = (o: object) => ({ gender: 'any' as const, ...o });
const messages = (p: ParameterInput[]) =>
  parameterIssues(p).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('parameterIssues (spec §6.19)', () => {
  it('accepts a realistic parameter set', () => {
    expect(
      parameterIssues([
        num([
          { gender: 'male', ageMinYears: 18, low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
          { gender: 'female', ageMinYears: 18, low: 12, high: 15.5 },
          r({ ageMaxYears: 17, low: 11, high: 16 }),
        ]),
        { key: 'ns1', name: 'NS1 antigen', valueType: 'option', options: ['Negative', 'Positive'] },
        { key: 'remarks', name: 'Remarks', valueType: 'text' },
        num([r({ high: 200, text: '< 200 desirable' })], 'chol'),
      ]),
    ).toEqual([]);
  });

  it('needs at least one parameter with unique keys', () => {
    expect(messages([])).toEqual(['parameters: Add at least one parameter']);
    expect(messages([num([]), num([])])).toEqual(['parameters.1.key: Key "hb" is used twice']);
  });

  it('option parameters need 2+ distinct options; others have none', () => {
    const opt = (options?: string[]): ParameterInput => ({
      key: 'o',
      name: 'O',
      valueType: 'option',
      options,
    });
    expect(messages([opt()])).toEqual(['parameters.0.options: Give at least 2 different options']);
    expect(messages([opt(['A', 'A'])])).toHaveLength(1);
    expect(messages([opt(['A', 'B', 'A'])])).toEqual([
      'parameters.0.options: Options must not repeat',
    ]);
    expect(messages([{ ...num([]), options: ['x'] }])).toEqual([
      'parameters.0.options: Only option parameters have options',
    ]);
  });

  it('only number parameters have ranges', () => {
    expect(messages([{ key: 't', name: 'T', valueType: 'text', ranges: [r({ low: 1 })] }])).toEqual(
      ['parameters.0.ranges: Only number parameters have ranges'],
    );
  });

  it('range values must be consistent', () => {
    expect(messages([num([r({ low: 10, high: 10 })])])).toEqual([
      'parameters.0.ranges.0.high: Must be greater than low',
    ]);
    expect(messages([num([r({ low: 10, high: 20, criticalLow: 11 })])])).toEqual([
      'parameters.0.ranges.0.criticalLow: Must be at most low',
    ]);
    expect(messages([num([r({ low: 10, high: 20, criticalHigh: 19 })])])).toEqual([
      'parameters.0.ranges.0.criticalHigh: Must be at least high',
    ]);
    expect(messages([num([r({ low: 10, high: 20, criticalLow: 10, criticalHigh: 20 })])])).toEqual(
      [],
    );
    expect(messages([num([r({ ageMinYears: 18, ageMaxYears: 5, low: 1 })])])).toEqual([
      'parameters.0.ranges.0.ageMaxYears: Must be at least ageMinYears',
    ]);
    expect(messages([num([r({ ageMinYears: 5, ageMaxYears: 5, low: 1 })])])).toEqual([]);
    expect(messages([num([r({ criticalLow: 1 })])])).toEqual([
      'parameters.0.ranges.0: Give low, high or a reference text',
    ]);
  });

  it('ranges for the same gender must not overlap in age (inclusive)', () => {
    expect(
      messages([
        num([
          { gender: 'male', ageMinYears: 0, ageMaxYears: 17, low: 11, high: 16 },
          { gender: 'male', ageMinYears: 17, low: 13, high: 17 },
        ]),
      ]),
    ).toEqual(['parameters.0.ranges.1: Overlaps the male, ages 0–17 range']);
    // Open-ended bands overlap everything of the same gender.
    expect(messages([num([r({ low: 1 }), r({ ageMinYears: 60, low: 2 })])])).toHaveLength(1);
    // Adjacent bands and different genders are fine; 'any' may sit alongside male/female.
    expect(
      messages([
        num([
          { gender: 'male', ageMaxYears: 17, low: 11, high: 16 },
          { gender: 'male', ageMinYears: 18, low: 13, high: 17 },
          { gender: 'female', low: 12, high: 15 },
          r({ low: 12, high: 16 }),
        ]),
      ]),
    ).toEqual([]);
  });
});
