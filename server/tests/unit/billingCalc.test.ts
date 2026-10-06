import {
  BillingCalcError,
  calcInvoice,
  calcLine,
  discountPercent,
  exceedsDiscountLimit,
  type LineInput,
} from '../../src/modules/invoices/calc.js';

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  quantity: 1,
  unitPricePaise: 10_000,
  discountPaise: 0,
  taxRateBps: 0,
  ...overrides,
});

const fieldOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BillingCalcError);
    return (err as BillingCalcError).field;
  }
  throw new Error('expected a BillingCalcError');
};

describe('calcLine (spec §8.9)', () => {
  it('18% of ₹333.33 rounds half-up to the paisa (5999.94 → 6000)', () => {
    expect(calcLine(line({ unitPricePaise: 33_333, taxRateBps: 1800 }))).toEqual({
      grossPaise: 33_333,
      taxablePaise: 33_333,
      taxPaise: 6000,
      lineTotalPaise: 39_333,
    });
  });

  it('rounds exact halves up and anything below a half down', () => {
    // 25 × 2% = 0.5 → 1; 75 × 2% = 1.5 → 2; 24 × 2% = 0.48 → 0; 26 × 2% = 0.52 → 1
    expect(calcLine(line({ unitPricePaise: 25, taxRateBps: 200 })).taxPaise).toBe(1);
    expect(calcLine(line({ unitPricePaise: 75, taxRateBps: 200 })).taxPaise).toBe(2);
    expect(calcLine(line({ unitPricePaise: 24, taxRateBps: 200 })).taxPaise).toBe(0);
    expect(calcLine(line({ unitPricePaise: 26, taxRateBps: 200 })).taxPaise).toBe(1);
    // 12% of ₹99.99 = 11.9988 → 12.00 (1200 paise)
    expect(calcLine(line({ unitPricePaise: 9999, taxRateBps: 1200 })).taxPaise).toBe(1200);
  });

  it('applies the discount before tax and multiplies by the quantity', () => {
    // 3 × ₹150 = ₹450 − ₹50 = ₹400; 5% tax = ₹20
    expect(
      calcLine(line({ quantity: 3, unitPricePaise: 15_000, discountPaise: 5000, taxRateBps: 500 })),
    ).toEqual({ grossPaise: 45_000, taxablePaise: 40_000, taxPaise: 2000, lineTotalPaise: 42_000 });
  });

  it('0% tax adds nothing', () => {
    expect(calcLine(line({ unitPricePaise: 12_345 }))).toEqual({
      grossPaise: 12_345,
      taxablePaise: 12_345,
      taxPaise: 0,
      lineTotalPaise: 12_345,
    });
  });

  it('a full discount makes the line free, tax included', () => {
    expect(
      calcLine(line({ quantity: 2, unitPricePaise: 500, discountPaise: 1000, taxRateBps: 1800 })),
    ).toEqual({ grossPaise: 1000, taxablePaise: 0, taxPaise: 0, lineTotalPaise: 0 });
  });

  it('100% tax doubles the taxable amount; a free line stays free', () => {
    expect(calcLine(line({ unitPricePaise: 333, taxRateBps: 10_000 })).lineTotalPaise).toBe(666);
    expect(calcLine(line({ unitPricePaise: 0, taxRateBps: 1800 })).lineTotalPaise).toBe(0);
  });

  it('stays exact for large amounts (no floating point)', () => {
    // ₹9,99,99,999.99 × 999 at 18%: computed in BigInt, still a safe integer.
    const r = calcLine(line({ quantity: 999, unitPricePaise: 9_999_999_999, taxRateBps: 1800 }));
    expect(r.grossPaise).toBe(9_989_999_999_001);
    expect(r.taxPaise).toBe(1_798_199_999_820); // 1798199999820.18 → …820
    expect(r.lineTotalPaise).toBe(r.grossPaise + r.taxPaise);
    expect(fieldOf(() => calcLine(line({ quantity: 999, unitPricePaise: 2 ** 52 })))).toBe(
      'unitPricePaise',
    );
  });

  it('rejects a discount larger than the line amount', () => {
    expect(fieldOf(() => calcLine(line({ discountPaise: 10_001 })))).toBe('discountPaise');
    expect(calcLine(line({ discountPaise: 10_000 })).lineTotalPaise).toBe(0);
  });

  it.each([
    [{ quantity: 0 }, 'quantity'],
    [{ quantity: 1000 }, 'quantity'],
    [{ quantity: 1.5 }, 'quantity'],
    [{ unitPricePaise: -1 }, 'unitPricePaise'],
    [{ unitPricePaise: 10.5 }, 'unitPricePaise'],
    [{ unitPricePaise: Number.NaN }, 'unitPricePaise'],
    [{ discountPaise: -1 }, 'discountPaise'],
    [{ discountPaise: 0.1 }, 'discountPaise'],
    [{ taxRateBps: -1 }, 'taxRateBps'],
    [{ taxRateBps: 10_001 }, 'taxRateBps'],
    [{ taxRateBps: 18.5 }, 'taxRateBps'],
  ] as const)('rejects %o', (overrides, field) => {
    expect(fieldOf(() => calcLine(line(overrides)))).toBe(field);
  });

  it('accepts the bounds: quantity 1 and 999, tax 0 and 10000 bps', () => {
    expect(() => calcLine(line({ quantity: 999, taxRateBps: 10_000 }))).not.toThrow();
    expect(() => calcLine(line({ quantity: 1, taxRateBps: 0 }))).not.toThrow();
  });
});

describe('calcInvoice', () => {
  it('sums the lines and computes the balance', () => {
    const totals = calcInvoice(
      [
        line({ unitPricePaise: 50_000, taxRateBps: 1800 }), // 50000 + 9000
        line({ quantity: 2, unitPricePaise: 25_000, discountPaise: 5000 }), // 45000
      ],
      20_000,
    );
    expect(totals).toEqual({
      subtotalPaise: 100_000,
      discountTotalPaise: 5000,
      taxTotalPaise: 9000,
      totalPaise: 104_000,
      amountPaidPaise: 20_000,
      balancePaise: 84_000,
    });
  });

  it('rounds per line, not on the invoice total', () => {
    // Each line: 25 × 2% = 0.5 → 1 paisa; on the total it would be 1.0 → 1.
    const totals = calcInvoice([
      line({ unitPricePaise: 25, taxRateBps: 200 }),
      line({ unitPricePaise: 25, taxRateBps: 200 }),
    ]);
    expect(totals.taxTotalPaise).toBe(2);
    expect(totals.totalPaise).toBe(52);
  });

  it('is all zeros without lines', () => {
    expect(calcInvoice([])).toEqual({
      subtotalPaise: 0,
      discountTotalPaise: 0,
      taxTotalPaise: 0,
      totalPaise: 0,
      amountPaidPaise: 0,
      balancePaise: 0,
    });
  });

  it('rejects a negative or fractional amount paid, and invalid lines', () => {
    expect(fieldOf(() => calcInvoice([line()], -1))).toBe('amountPaidPaise');
    expect(fieldOf(() => calcInvoice([line()], 0.5))).toBe('amountPaidPaise');
    expect(fieldOf(() => calcInvoice([line(), line({ quantity: 0 })]))).toBe('quantity');
  });
});

describe('discount limit (§4.9)', () => {
  const discounted = (discountPaise: number) => [
    line({ unitPricePaise: 60_000, discountPaise }),
    line({ unitPricePaise: 40_000 }),
  ];

  it('discountPercent is the discount over the gross amount (before tax)', () => {
    expect(discountPercent(discounted(10_000))).toBe(10);
    expect(discountPercent(discounted(0))).toBe(0);
    expect(discountPercent([])).toBe(0);
    expect(discountPercent([line({ unitPricePaise: 0 })])).toBe(0);
  });

  it('exactly the limit is allowed; one paisa more is not', () => {
    expect(exceedsDiscountLimit(discounted(10_000), 10)).toBe(false);
    expect(exceedsDiscountLimit(discounted(10_001), 10)).toBe(true);
    expect(exceedsDiscountLimit(discounted(0), 0)).toBe(false);
    expect(exceedsDiscountLimit(discounted(1), 0)).toBe(true);
  });

  it('ignores tax when comparing', () => {
    const lines = [line({ unitPricePaise: 10_000, discountPaise: 1000, taxRateBps: 1800 })];
    expect(exceedsDiscountLimit(lines, 10)).toBe(false);
  });
});
