import { BILLING_RULES } from '../../config/constants.js';

/**
 * Billing calculations (spec §8.9) – pure, integer paise only, never floats:
 * - line: `gross = quantity × unitPrice`; `taxable = gross − discount`;
 *   `tax = round(taxable × taxRateBps / 10000)` rounded half-up to the paisa; `lineTotal =
 *   taxable + tax`;
 * - invoice: sums of the lines; `balance = total − amountPaid`.
 * The server always recomputes these from the lines; totals sent by a client are ignored.
 */

export interface LineInput {
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxRateBps: number;
}

export interface LineAmounts {
  grossPaise: number;
  taxablePaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

export interface InvoiceTotals {
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
}

/** A line that breaks the rules; `field` names the offending property. */
export class BillingCalcError extends Error {
  constructor(
    readonly field: keyof LineInput | 'amountPaidPaise',
    message: string,
  ) {
    super(message);
    this.name = 'BillingCalcError';
  }
}

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

function check(line: LineInput): void {
  const { quantity, unitPricePaise, discountPaise, taxRateBps } = line;
  if (!isWhole(quantity) || quantity < 1 || quantity > BILLING_RULES.maxQuantity) {
    throw new BillingCalcError(
      'quantity',
      `Quantity must be a whole number from 1 to ${BILLING_RULES.maxQuantity}`,
    );
  }
  if (!isWhole(unitPricePaise) || unitPricePaise < 0) {
    throw new BillingCalcError(
      'unitPricePaise',
      'Price must be a whole number of paise, 0 or more',
    );
  }
  if (!isWhole(discountPaise) || discountPaise < 0) {
    throw new BillingCalcError(
      'discountPaise',
      'Discount must be a whole number of paise, 0 or more',
    );
  }
  if (!isWhole(taxRateBps) || taxRateBps < 0 || taxRateBps > BILLING_RULES.maxTaxRateBps) {
    throw new BillingCalcError('taxRateBps', 'Tax rate must be 0–10000 basis points');
  }
}

/** One line's amounts (§8.9). Throws BillingCalcError for invalid input or discount > gross. */
export function calcLine(line: LineInput): LineAmounts {
  check(line);
  const gross = BigInt(line.quantity) * BigInt(line.unitPricePaise);
  const discount = BigInt(line.discountPaise);
  if (discount > gross) {
    throw new BillingCalcError('discountPaise', 'The discount cannot be more than the line amount');
  }
  const taxable = gross - discount;
  // Half-up to the nearest paisa: (x + 0.5) floored, in integers. taxable and bps are ≥ 0.
  const tax = (taxable * BigInt(line.taxRateBps) + 5000n) / 10000n;
  const total = taxable + tax;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BillingCalcError('unitPricePaise', 'The line amount is too large');
  }
  return {
    grossPaise: Number(gross),
    taxablePaise: Number(taxable),
    taxPaise: Number(tax),
    lineTotalPaise: Number(total),
  };
}

/** Invoice totals from its lines (§8.9). `amountPaidPaise` = net paid (payments − refunds). */
export function calcInvoice(items: readonly LineInput[], amountPaidPaise = 0): InvoiceTotals {
  if (!isWhole(amountPaidPaise) || amountPaidPaise < 0) {
    throw new BillingCalcError('amountPaidPaise', 'The amount paid must be whole paise, 0 or more');
  }
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  for (const item of items) {
    const line = calcLine(item);
    subtotal += line.grossPaise;
    discount += item.discountPaise;
    tax += line.taxPaise;
    total += line.lineTotalPaise;
  }
  if (!Number.isSafeInteger(total)) {
    throw new BillingCalcError('unitPricePaise', 'The invoice total is too large');
  }
  return {
    subtotalPaise: subtotal,
    discountTotalPaise: discount,
    taxTotalPaise: tax,
    totalPaise: total,
    amountPaidPaise,
    balancePaise: total - amountPaidPaise,
  };
}

/**
 * Total discount as a percentage of the gross amount (before tax), for display and the admin
 * rule. 0 when there is nothing to discount.
 */
export function discountPercent(items: readonly LineInput[]): number {
  const { subtotalPaise, discountTotalPaise } = calcInvoice(items);
  if (subtotalPaise === 0) return 0;
  return (discountTotalPaise * 100) / subtotalPaise;
}

/**
 * Whether the discount is above `maxPercent` of the gross amount (§4.9: needs an admin). Exact:
 * compares `discount × 100 > max × gross` without dividing.
 */
export function exceedsDiscountLimit(items: readonly LineInput[], maxPercent: number): boolean {
  const { subtotalPaise, discountTotalPaise } = calcInvoice(items);
  if (discountTotalPaise === 0) return false;
  return discountTotalPaise * 100 > maxPercent * subtotalPaise;
}

/**
 * An issued invoice's status from its amounts (spec §8.9, §5.5): nothing paid (net of refunds)
 * → issued; everything → paid; otherwise partially_paid.
 */
export function statusForAmounts(
  totalPaise: number,
  amountPaidPaise: number,
): 'issued' | 'partially_paid' | 'paid' {
  if (amountPaidPaise <= 0) return totalPaise === 0 ? 'paid' : 'issued';
  return amountPaidPaise >= totalPaise ? 'paid' : 'partially_paid';
}
