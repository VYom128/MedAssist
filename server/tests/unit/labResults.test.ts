import { buildResults, type CatalogueParameter } from '../../src/modules/labOrders/results.js';

const params: CatalogueParameter[] = [
  {
    key: 'hb',
    name: 'Haemoglobin',
    unit: 'g/dL',
    valueType: 'number',
    ranges: [{ low: 12, high: 16, criticalLow: 7 }],
  },
  {
    key: 'smear',
    name: 'Smear',
    valueType: 'option',
    options: ['Negative', 'Positive'],
    abnormalOptions: ['Positive'],
  },
  { key: 'note', name: 'Appearance', valueType: 'text' },
];

describe('buildResults', () => {
  it('stores values in catalogue order with server flags and references', () => {
    const built = buildResults(
      params,
      [
        { parameterKey: 'note', value: '  Clear  ' },
        { parameterKey: 'smear', value: 'Positive' },
        { parameterKey: 'hb', value: 6.5 },
      ],
      { gender: 'female', ageYears: 30 },
    );
    expect(built.issues).toEqual([]);
    expect(built.missing).toEqual([]);
    expect(built.critical).toBe(1);
    expect(built.results).toEqual([
      {
        parameterKey: 'hb',
        name: 'Haemoglobin',
        unit: 'g/dL',
        value: 6.5,
        referenceText: '12–16 g/dL',
        flag: 'critical_low',
      },
      {
        parameterKey: 'smear',
        name: 'Smear',
        value: 'Positive',
        referenceText: 'Negative',
        flag: 'abnormal',
      },
      { parameterKey: 'note', name: 'Appearance', value: 'Clear', flag: 'na' },
    ]);
  });

  it('blank values (null, empty, spaces) and absent parameters are missing, not errors', () => {
    const built = buildResults(
      params,
      [
        { parameterKey: 'hb', value: null },
        { parameterKey: 'note', value: '   ' },
      ],
      {},
    );
    expect(built.issues).toEqual([]);
    expect(built.results).toEqual([]);
    expect(built.missing).toEqual(['hb', 'smear', 'note']);
  });

  it('reports bad values with their input position', () => {
    const built = buildResults(
      params,
      [
        { parameterKey: 'smear', value: 'Maybe' },
        { parameterKey: 'note', value: 'x'.repeat(501) },
        { parameterKey: 'hb', value: Number.POSITIVE_INFINITY },
      ],
      {},
    );
    expect(built.issues).toEqual([
      { field: 'body.results.2.value', message: 'Enter a number' },
      { field: 'body.results.0.value', message: 'Choose one of the options' },
      { field: 'body.results.1.value', message: 'At most 500 characters' },
    ]);
  });
});
