import {
  bpsToPercent,
  formatINR,
  formatPercentFromBps,
  paiseToRupees,
  percentToBps,
  rupeesToPaise,
} from '../src/utils/money';

describe('money helpers (integer paise)', () => {
  it('formats paise as rupees with Indian grouping', () => {
    expect(formatINR(125_050)).toBe('₹1,250.50');
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(12_500_000)).toBe('₹1,25,000.00');
    expect(formatINR(null)).toBe('—');
  });

  it.each([
    ['500', 50_000],
    ['1,250.5', 125_050],
    ['₹ 19.99', 1999],
    ['499.995', 50_000], // half-up; 499.995 * 100 in floats is 49999.49999…
    ['1.005', 101],
    ['0.004', 0],
    ['7.', 700],
  ])('rupeesToPaise(%s) = %i', (text, paise) => {
    expect(rupeesToPaise(text)).toBe(paise);
  });

  it('empty is null; anything else that is not an amount is NaN', () => {
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('  ')).toBeNull();
    for (const bad of ['-5', 'abc', '1e3', '12.3.4']) expect(rupeesToPaise(bad)).toBeNaN();
  });

  it('paiseToRupees gives form-friendly text', () => {
    expect(paiseToRupees(50_000)).toBe('500');
    expect(paiseToRupees(125_050)).toBe('1250.50');
    expect(paiseToRupees(5)).toBe('0.05');
    expect(paiseToRupees(null)).toBe('');
  });

  it('converts tax percentages and basis points', () => {
    expect(percentToBps(18)).toBe(1800);
    expect(percentToBps(12.5)).toBe(1250);
    expect(percentToBps(0.29)).toBe(29); // 0.29 * 100 = 28.999… in floats
    expect(bpsToPercent(1800)).toBe(18);
    expect(formatPercentFromBps(1250)).toBe('12.5%');
    expect(formatPercentFromBps(0)).toBe('0%');
  });
});
