import { assertPaise, isPaise, paiseToRupees, rupeesToPaise } from '../../src/utils/money.js';

describe('money (integer paise)', () => {
  it.each([
    [0, 0],
    [500, 50_000],
    ['1250.5', 125_050],
    [0.1, 10],
    [19.99, 1999],
    [499.995, 50_000], // half-up; 499.995 * 100 in floats is 49999.49999…
    [499.994, 49_999],
    [1.005, 101], // 1.005 * 100 = 100.49999… in floats
    ['0.015', 2],
    ['7.', 700],
  ])('rupeesToPaise(%s) = %i', (rupees, expected) => {
    expect(rupeesToPaise(rupees)).toBe(expected);
  });

  it.each([-1, Number.NaN, Infinity, 1e21, '12,50', '-5', '', 'abc', '1e3'])(
    'rupeesToPaise rejects %s',
    (bad) => {
      expect(() => rupeesToPaise(bad as number | string)).toThrow(RangeError);
    },
  );

  it('paiseToRupees', () => {
    expect(paiseToRupees(125_050)).toBe(1250.5);
    expect(paiseToRupees(0)).toBe(0);
    expect(() => paiseToRupees(10.5)).toThrow();
  });

  it('assertPaise accepts only non-negative integers', () => {
    expect(isPaise(0)).toBe(true);
    expect(isPaise(99_999)).toBe(true);
    for (const bad of [-1, 1.5, '100', null, Number.NaN, 2 ** 60]) {
      expect(isPaise(bad)).toBe(false);
      expect(() => assertPaise(bad, 'body.pricePaise')).toThrow(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: [expect.objectContaining({ field: 'body.pricePaise' })],
        }),
      );
    }
  });
});
