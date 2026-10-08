import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { Payment } from '../../payments/model.js';
import { links } from '../links.js';
import { defineSource, joinParts, newestFirst, windowFilter } from '../types.js';
import { rupees } from './invoices.js';

interface Row {
  _id: Types.ObjectId;
  paymentNumber: string;
  receivedAt: Date;
  amountPaise: number;
  method: string;
  kind: string;
  invoice?: { _id: Types.ObjectId; invoiceNumber?: string | null } | null;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  insurance: 'Insurance',
  other: 'Other',
};

/** Payments and refunds (shown as refunds) when received, with the invoice they belong to. */
export const paymentSource = defineSource<Row>({
  type: 'payment',
  rolesAllowed: [ROLES.RECEPTIONIST, ROLES.PATIENT],
  async query(patient, q) {
    return Payment.find({ patient, $and: windowFilter('receivedAt', 'payment', q) })
      .select('paymentNumber receivedAt amountPaise method kind invoice')
      .sort(newestFirst('receivedAt'))
      .limit(q.limit)
      .populate({ path: 'invoice', select: 'invoiceNumber' })
      .lean<Row[]>();
  },
  toItem(p, viewer) {
    const refund = p.kind === 'refund';
    const invoiceId = p.invoice?._id.toString();
    return {
      type: 'payment',
      id: p._id.toString(),
      at: p.receivedAt,
      title: `${refund ? 'Refund' : 'Payment'} ${p.paymentNumber}`,
      subtitle: joinParts(
        refund ? `${rupees(-p.amountPaise)} refunded` : `${rupees(p.amountPaise)} paid`,
        METHOD_LABELS[p.method] ?? p.method,
        p.invoice?.invoiceNumber,
      ),
      status: p.kind,
      link: invoiceId ? links.invoice(viewer.role, invoiceId) : null,
      flags: refund ? ['refund'] : [],
    };
  },
});
