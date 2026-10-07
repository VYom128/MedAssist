import type { Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants.js';
import { calendarDateString } from '../../utils/dates.js';
import { formatPhone } from '../../utils/phone.js';
import { calcLine, discountPercent } from './calc.js';
import type { PricedLine } from './lines.js';

/** Invoice references for audit entries. */
export const resourceOf = (i: { _id: Types.ObjectId; invoiceNumber?: string | null }) => ({
  type: 'invoice',
  id: i._id,
  ...(i.invoiceNumber ? { number: i.invoiceNumber } : {}),
});

const NAME = 'firstName lastName';

export const INVOICE_POPULATE = [
  { path: 'patient', select: 'mrn firstName lastName phone' },
  {
    path: 'appointment',
    select: 'appointmentNumber startAt doctor',
    populate: { path: 'doctor', select: NAME },
  },
  { path: 'issuedBy', select: NAME },
  { path: 'void.by', select: NAME },
  { path: 'discountApproval.by', select: NAME },
  { path: 'createdBy', select: NAME },
] as const;

export const INVOICE_LIST_POPULATE = [
  { path: 'patient', select: 'mrn firstName lastName' },
  {
    path: 'appointment',
    select: 'appointmentNumber startAt doctor',
    populate: { path: 'doctor', select: NAME },
  },
] as const;

interface PersonRef {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

/** A lean invoice with the INVOICE_POPULATE paths populated (or not, for list rows). */
export interface InvoiceLike {
  _id: Types.ObjectId;
  __v?: number;
  invoiceNumber?: string | null;
  kind: string;
  status: string;
  patient: PersonRef & { mrn?: string; phone?: string | null };
  appointment?:
    | (PersonRef & {
        appointmentNumber?: string;
        startAt?: Date;
        doctor?: PersonRef | null;
      })
    | null;
  items: PricedLine[];
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
  currency?: string;
  issuedAt?: Date | null;
  issuedBy?: PersonRef | null;
  dueDate?: Date | null;
  void?: { by?: PersonRef | null; at?: Date | null; reason?: string | null } | null;
  notes?: string | null;
  discountApproval?: { by?: PersonRef | null; at?: Date | null } | null;
  cancelledItemsBilled?: {
    lineId?: Types.ObjectId | null;
    description: string;
    lineTotalPaise: number;
    labOrderId: Types.ObjectId;
    itemId: Types.ObjectId;
    at: Date;
  }[];
  statusHistory?: { status: string; at: Date; by?: Types.ObjectId | null; note?: string | null }[];
  createdBy?: PersonRef | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const idOf = (ref?: { _id: Types.ObjectId } | Types.ObjectId | null) =>
  ref ? ('_id' in ref ? ref._id : ref).toString() : null;
const nameOf = (p?: PersonRef | null) =>
  p?.firstName ? `${p.firstName} ${p.lastName ?? ''}`.trim() : null;

function lineView(l: PricedLine) {
  const { grossPaise, taxablePaise } = calcLine(l);
  return {
    id: l._id.toString(),
    kind: l.kind,
    origin: l.origin,
    refId: l.refId?.toString() ?? null,
    labOrderId: l.labOrder?.toString() ?? null,
    labOrderItemId: l.labOrderItem?.toString() ?? null,
    description: l.description,
    quantity: l.quantity,
    unitPricePaise: l.unitPricePaise,
    discountPaise: l.discountPaise,
    taxRateBps: l.taxRateBps,
    grossPaise,
    taxablePaise,
    taxPaise: l.taxPaise,
    lineTotalPaise: l.lineTotalPaise,
  };
}

const totals = (i: InvoiceLike) => ({
  subtotalPaise: i.subtotalPaise,
  discountTotalPaise: i.discountTotalPaise,
  taxTotalPaise: i.taxTotalPaise,
  totalPaise: i.totalPaise,
  amountPaidPaise: i.amountPaidPaise,
  balancePaise: i.balancePaise,
});

function patientRef(i: InvoiceLike, withPhone: boolean) {
  const p = i.patient;
  return {
    id: idOf(p),
    name: nameOf(p),
    mrn: p.mrn ?? null,
    ...(withPhone ? { phone: p.phone ? formatPhone(p.phone) : null } : {}),
  };
}

function appointmentRef(i: InvoiceLike) {
  const a = i.appointment;
  if (!a) return null;
  return {
    id: idOf(a),
    appointmentNumber: a.appointmentNumber ?? null,
    startAt: a.startAt ?? null,
    doctorName: nameOf(a.doctor),
  };
}

/**
 * The invoice for reception and admins (everything), or for its patient (no internal notes,
 * history, approvals or the cancelled-tests list – reception handles those).
 */
export function toView(i: InvoiceLike, role: Role) {
  const staff = role !== ROLES.PATIENT;
  const base = {
    id: i._id.toString(),
    invoiceNumber: i.invoiceNumber ?? null,
    kind: i.kind,
    status: i.status,
    revision: i.__v ?? 0,
    patient: patientRef(i, staff),
    appointment: appointmentRef(i),
    items: i.items.map(lineView),
    ...totals(i),
    discountPercent: Math.round(discountPercent(i.items) * 100) / 100,
    currency: i.currency ?? 'INR',
    issuedAt: i.issuedAt ?? null,
    dueDate: i.dueDate ? calendarDateString(i.dueDate) : null,
    void: i.void?.at ? { at: i.void.at, reason: i.void.reason ?? null } : null,
    createdAt: i.createdAt ?? null,
    updatedAt: i.updatedAt ?? null,
  };
  if (!staff) return base;
  return {
    ...base,
    issuedBy: i.issuedBy ? { id: idOf(i.issuedBy), name: nameOf(i.issuedBy) } : null,
    void: i.void?.at
      ? { at: i.void.at, reason: i.void.reason ?? null, byName: nameOf(i.void.by) }
      : null,
    notes: i.notes ?? null,
    discountApproval: i.discountApproval?.at
      ? { at: i.discountApproval.at, byName: nameOf(i.discountApproval.by) }
      : null,
    cancelledItemsBilled: (i.cancelledItemsBilled ?? []).map((c) => ({
      lineId: c.lineId?.toString() ?? null,
      description: c.description,
      lineTotalPaise: c.lineTotalPaise,
      labOrderId: c.labOrderId.toString(),
      itemId: c.itemId.toString(),
      at: c.at,
    })),
    statusHistory: (i.statusHistory ?? []).map((h) => ({
      status: h.status,
      at: h.at,
      by: h.by?.toString() ?? null,
      note: h.note ?? null,
    })),
    createdByName: nameOf(i.createdBy),
  };
}

/** A list row (no lines). */
export function toListItem(i: InvoiceLike) {
  return {
    id: i._id.toString(),
    invoiceNumber: i.invoiceNumber ?? null,
    kind: i.kind,
    status: i.status,
    patient: patientRef(i, false),
    appointment: appointmentRef(i),
    lineCount: i.items.length,
    ...totals(i),
    issuedAt: i.issuedAt ?? null,
    createdAt: i.createdAt ?? null,
    hasCancelledItemsBilled: (i.cancelledItemsBilled ?? []).length > 0,
  };
}
