import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { formatIndianAmount } from '../../../utils/money.js';
import { Invoice } from '../../invoices/model.js';
import { links } from '../links.js';
import { defineSource, joinParts, newestFirst, windowFilter } from '../types.js';

interface Row {
  _id: Types.ObjectId;
  invoiceNumber?: string | null;
  issuedAt: Date;
  status: string;
  totalPaise: number;
  balancePaise: number;
}

export const rupees = (paise: number) => `₹${formatIndianAmount(paise)}`;

function amountLine(i: Row): string {
  const total = rupees(i.totalPaise);
  switch (i.status) {
    case 'paid':
      return `${total} paid`;
    case 'partially_paid':
      return `${total} · ${rupees(i.balancePaise)} due`;
    case 'issued':
      return `${total} due`;
    default:
      return total;
  }
}

/** Issued invoices (never drafts) at their issue time, with the total and what is due. */
export const invoiceSource = defineSource<Row>({
  type: 'invoice',
  rolesAllowed: [ROLES.RECEPTIONIST, ROLES.PATIENT],
  async query(patient, q) {
    return Invoice.find({
      patient,
      status: { $ne: 'draft' },
      $and: windowFilter('issuedAt', 'invoice', q),
    })
      .select('invoiceNumber issuedAt status totalPaise balancePaise')
      .sort(newestFirst('issuedAt'))
      .limit(q.limit)
      .lean<Row[]>();
  },
  toItem(i, viewer) {
    const id = i._id.toString();
    return {
      type: 'invoice',
      id,
      at: i.issuedAt,
      title: `Invoice ${i.invoiceNumber ?? ''}`.trim(),
      subtitle: joinParts(amountLine(i)),
      status: i.status,
      link: links.invoice(viewer.role, id),
      flags: [],
    };
  },
});
