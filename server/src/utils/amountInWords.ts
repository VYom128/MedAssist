/**
 * An amount of money in words with the Indian numbering system (thousand, lakh, crore), as
 * printed on invoices and receipts:
 * 125050 paise → 'Rupees One Thousand Two Hundred Fifty and Fifty Paise Only'.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 in words ('' for 0). */
function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  return [TENS[Math.floor(n / 10)]!, ONES[n % 10]!].filter(Boolean).join(' ');
}

/** 0–999 in words ('' for 0). */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', belowHundred(n % 100)]
    .filter(Boolean)
    .join(' ');
}

/**
 * A whole number in words, Indian style: 12,34,56,789 → 'Twelve Crore Thirty Four Lakh Fifty Six
 * Thousand Seven Hundred Eighty Nine'. Above 99 crore the crore count itself is spelt out the
 * same way ('One Thousand Two Hundred Crore'). 0 → 'Zero'.
 */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Not a whole number: ${n}`);
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${numberInWords(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    belowThousand(rest),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Paise in words: 'Rupees … and … Paise Only' ('Rupees Zero Only' for 0; one paisa is 'Paisa').
 * @throws RangeError for negative or fractional paise (print refunds as positive amounts).
 */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new RangeError(`Not a whole, non-negative number of paise: ${paise}`);
  }
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const fraction = rest ? ` and ${belowHundred(rest)} ${rest === 1 ? 'Paisa' : 'Paise'}` : '';
  return `Rupees ${numberInWords(rupees)}${fraction} Only`;
}
