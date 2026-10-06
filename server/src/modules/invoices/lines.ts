import { Types, type ClientSession } from 'mongoose';
import type { InvoiceLineKind } from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { Service } from '../services/model.js';
import { getSettings } from '../settings/service.js';
import { BillingCalcError, calcInvoice, calcLine, type LineInput } from './calc.js';

/** A line before its amounts are computed. */
export interface LineFields extends LineInput {
  _id?: Types.ObjectId;
  kind: InvoiceLineKind;
  origin: 'visit' | 'staff';
  refId?: Types.ObjectId | null;
  labOrder?: Types.ObjectId | null;
  labOrderItem?: Types.ObjectId | null;
  description: string;
}

/** A line as stored: its fields plus the computed tax and total. */
export interface PricedLine extends LineFields {
  _id: Types.ObjectId;
  taxPaise: number;
  lineTotalPaise: number;
}

/**
 * Converts a calculation error on line `index` into 400 VALIDATION_ERROR with the field path
 * (`body.items.2.discountPaise`). Other errors pass through.
 */
export function asValidationError(err: unknown, index: number, prefix = 'body.items'): unknown {
  if (!(err instanceof BillingCalcError)) return err;
  return ApiError.validation(err.message, [
    { field: `${prefix}.${index}.${err.field}`, message: err.message },
  ]);
}

/** The line with its tax and total computed on the server (client amounts are never used). */
export function priceLine(line: LineFields, index = 0): PricedLine {
  try {
    const { taxPaise, lineTotalPaise } = calcLine(line);
    return {
      _id: line._id ?? new Types.ObjectId(),
      kind: line.kind,
      origin: line.origin,
      ...(line.refId ? { refId: line.refId } : {}),
      ...(line.labOrder ? { labOrder: line.labOrder } : {}),
      ...(line.labOrderItem ? { labOrderItem: line.labOrderItem } : {}),
      description: line.description,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      discountPaise: line.discountPaise,
      taxRateBps: line.taxRateBps,
      taxPaise,
      lineTotalPaise,
    };
  } catch (err) {
    throw asValidationError(err, index);
  }
}

/** The invoice's total fields for these lines (§8.9). */
export function totalsOf(lines: readonly LineInput[], amountPaidPaise = 0) {
  return calcInvoice(lines, amountPaidPaise);
}

/** The clinic's default tax rate (basis points). */
export async function defaultTaxRateBps(): Promise<number> {
  const settings = await getSettings();
  return settings.billing?.defaultTaxRateBps ?? 0;
}

/** A service's own tax rate, else the clinic default (decision: lab tests use the default). */
export async function taxRateForService(
  serviceId: Types.ObjectId | string | null | undefined,
  session?: ClientSession,
): Promise<number> {
  if (serviceId) {
    const service = await Service.findById(serviceId)
      .select('taxRateBps')
      .session(session ?? null)
      .lean();
    if (service && typeof service.taxRateBps === 'number') return service.taxRateBps;
  }
  return defaultTaxRateBps();
}

/** The appointment's consultation line from its service snapshot (price at booking). */
export async function consultationLine(
  appt: {
    service?: Types.ObjectId | null;
    serviceSnapshot: { name: string; pricePaise: number };
  },
  session?: ClientSession,
): Promise<PricedLine> {
  return priceLine({
    kind: 'consultation',
    origin: 'visit',
    refId: appt.service ?? null,
    description: appt.serviceSnapshot.name,
    quantity: 1,
    unitPricePaise: appt.serviceSnapshot.pricePaise,
    discountPaise: 0,
    taxRateBps: await taxRateForService(appt.service, session),
  });
}

/** One line per given lab order item, at the price snapshotted when it was ordered. */
export function labTestLines(
  order: {
    _id: Types.ObjectId;
    items: {
      _id: Types.ObjectId;
      test: Types.ObjectId;
      testSnapshot: { name: string; pricePaise: number };
    }[];
  },
  taxRateBps: number,
): PricedLine[] {
  return order.items.map((item) =>
    priceLine({
      kind: 'lab_test',
      origin: 'visit',
      refId: item.test,
      labOrder: order._id,
      labOrderItem: item._id,
      description: item.testSnapshot.name,
      quantity: 1,
      unitPricePaise: item.testSnapshot.pricePaise,
      discountPaise: 0,
      taxRateBps,
    }),
  );
}
