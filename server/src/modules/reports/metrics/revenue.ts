import { PAYMENT_METHODS, type PaymentMethod } from '../../../config/constants.js';
import { Invoice } from '../../invoices/model.js';
import { Payment } from '../../payments/model.js';
import { clinicDayKey, clinicMonthKey, inRange, type ClinicRange } from './range.js';

/**
 * Money metrics (spec §14, Phase 10 decisions), integer paise only:
 * - collected = payments − refunds by `receivedAt` (refunds are negative payments);
 * - billed = totals of issued invoices by `issuedAt` (issued, partially paid, paid – not drafts
 *   or void; there are no credit notes);
 * - outstanding = balances of issued and partially paid invoices, as of now.
 */

export interface CollectedRow {
  key: string;
  paymentsPaise: number;
  refundsPaise: number;
  netPaise: number;
}

const BILLED_STATUSES = ['issued', 'partially_paid', 'paid'] as const;

/** Collected money in the range, as one total or per clinic day, month or payment method. */
export async function collectedRevenue(
  r: ClinicRange,
  groupBy: 'total' | 'day' | 'month' | 'method' = 'total',
): Promise<CollectedRow[]> {
  const key =
    groupBy === 'day'
      ? clinicDayKey('receivedAt', r.timezone)
      : groupBy === 'month'
        ? clinicMonthKey('receivedAt', r.timezone)
        : groupBy === 'method'
          ? '$method'
          : 'total';
  const rows = await Payment.aggregate<{ _id: string; payments: number; refunds: number }>([
    { $match: inRange('receivedAt', r) },
    {
      $group: {
        _id: key,
        payments: { $sum: { $cond: [{ $gt: ['$amountPaise', 0] }, '$amountPaise', 0] } },
        refunds: { $sum: { $cond: [{ $lt: ['$amountPaise', 0] }, { $abs: '$amountPaise' }, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const out = rows.map((x) => ({
    key: String(x._id),
    paymentsPaise: x.payments,
    refundsPaise: x.refunds,
    netPaise: x.payments - x.refunds,
  }));
  if (groupBy === 'total' && out.length === 0) {
    return [{ key: 'total', paymentsPaise: 0, refundsPaise: 0, netPaise: 0 }];
  }
  if (groupBy === 'method') {
    // Every method, in the catalogue order.
    return PAYMENT_METHODS.map(
      (m: PaymentMethod) =>
        out.find((x) => x.key === m) ?? { key: m, paymentsPaise: 0, refundsPaise: 0, netPaise: 0 },
    );
  }
  return out;
}

/** Net collected in the range (one number). */
export async function collectedNet(r: ClinicRange): Promise<number> {
  return (await collectedRevenue(r, 'total'))[0]!.netPaise;
}

export interface BilledRow {
  key: string;
  label: string;
  invoices: number;
  quantity: number;
  billedPaise: number;
}

/** Billed in the range: one total, per clinic day / month, or per billed item (service). */
export async function billed(
  r: ClinicRange,
  groupBy: 'total' | 'day' | 'month' | 'service' = 'total',
): Promise<BilledRow[]> {
  const match = { status: { $in: BILLED_STATUSES }, ...inRange('issuedAt', r) };
  if (groupBy === 'service') {
    const rows = await Invoice.aggregate<{
      _id: { kind: string; description: string };
      invoices: number;
      quantity: number;
      billed: number;
    }>([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: { kind: '$items.kind', description: '$items.description' },
          invoices: { $addToSet: '$_id' },
          quantity: { $sum: '$items.quantity' },
          billed: { $sum: '$items.lineTotalPaise' },
        },
      },
      { $project: { invoices: { $size: '$invoices' }, quantity: 1, billed: 1 } },
      { $sort: { billed: -1, '_id.description': 1 } },
    ]);
    return rows.map((x) => ({
      key: `${x._id.kind}:${x._id.description}`,
      label: x._id.description,
      invoices: x.invoices,
      quantity: x.quantity,
      billedPaise: x.billed,
    }));
  }
  const key =
    groupBy === 'day'
      ? clinicDayKey('issuedAt', r.timezone)
      : groupBy === 'month'
        ? clinicMonthKey('issuedAt', r.timezone)
        : 'total';
  const rows = await Invoice.aggregate<{ _id: string; invoices: number; billed: number }>([
    { $match: match },
    { $group: { _id: key, invoices: { $sum: 1 }, billed: { $sum: '$totalPaise' } } },
    { $sort: { _id: 1 } },
  ]);
  const out = rows.map((x) => ({
    key: String(x._id),
    label: String(x._id),
    invoices: x.invoices,
    quantity: x.invoices,
    billedPaise: x.billed,
  }));
  if (groupBy === 'total' && out.length === 0) {
    return [{ key: 'total', label: 'total', invoices: 0, quantity: 0, billedPaise: 0 }];
  }
  return out;
}

/** Balances still owed on issued and partially paid invoices (now). */
export async function outstanding(): Promise<{ invoices: number; balancePaise: number }> {
  const [row] = await Invoice.aggregate<{ invoices: number; balance: number }>([
    { $match: { status: { $in: ['issued', 'partially_paid'] } } },
    { $group: { _id: null, invoices: { $sum: 1 }, balance: { $sum: '$balancePaise' } } },
  ]);
  return { invoices: row?.invoices ?? 0, balancePaise: row?.balance ?? 0 };
}
