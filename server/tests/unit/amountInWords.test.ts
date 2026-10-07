import { amountInWords, numberInWords } from '../../src/utils/amountInWords.js';
import { formatIndianAmount } from '../../src/utils/money.js';

describe('amountInWords (Indian numbering)', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [100, 'Rupees One Only'],
    [9999, 'Rupees Ninety Nine and Ninety Nine Paise Only'],
    [125_050, 'Rupees One Thousand Two Hundred Fifty and Fifty Paise Only'],
    [10_000_000, 'Rupees One Lakh Only'],
    [
      123_456_789_50,
      'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and ' +
        'Fifty Paise Only',
    ],
    [1, 'Rupees Zero and One Paisa Only'],
    [50, 'Rupees Zero and Fifty Paise Only'],
    [1_100, 'Rupees Eleven Only'],
    [100_100, 'Rupees One Thousand One Only'],
    [1_000_000_000, 'Rupees One Crore Only'],
    [
      999_999_999,
      'Rupees Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only',
    ],
  ])('%i paise → %s', (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });

  it('spells crores above 99 crore with the same system', () => {
    expect(numberInWords(12_000_000_000)).toBe('One Thousand Two Hundred Crore');
    expect(numberInWords(1_00_00_00_000 + 5)).toBe('One Hundred Crore Five');
    expect(numberInWords(20_15_000)).toBe('Twenty Lakh Fifteen Thousand');
  });

  it('rejects negative and fractional amounts', () => {
    expect(() => amountInWords(-1)).toThrow(RangeError);
    expect(() => amountInWords(1.5)).toThrow(RangeError);
    expect(() => numberInWords(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatIndianAmount', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [99_999, '999.99'],
    [100_000, '1,000.00'],
    [10_000_000, '1,00,000.00'],
    [123_456_789_50, '12,34,56,789.50'],
    [-50_000, '-500.00'],
  ])('%i → %s', (paise, text) => {
    expect(formatIndianAmount(paise)).toBe(text);
  });

  it('rejects fractional paise', () => {
    expect(() => formatIndianAmount(1.5)).toThrow(RangeError);
  });
});
