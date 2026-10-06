import type { Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants.js';

/** Payment references for audit entries. */
export const resourceOf = (p: { _id: Types.ObjectId; paymentNumber: string }) => ({
  type: 'payment',
  id: p._id,
  number: p.paymentNumber,
});

interface PersonRef {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

export interface PaymentLike {
  _id: Types.ObjectId;
  paymentNumber: string;
  invoice: Types.ObjectId | (PersonRef & { invoiceNumber?: string | null });
  patient: Types.ObjectId | PersonRef;
  amountPaise: number;
  method: string;
  reference?: string | null;
  kind: 'payment' | 'refund';
  refundOf?: Types.ObjectId | null;
  reason?: string | null;
  receivedBy: Types.ObjectId | PersonRef;
  receivedAt: Date;
}

const nameOf = (p: Types.ObjectId | PersonRef | null | undefined) =>
  p && 'firstName' in p && p.firstName ? `${p.firstName} ${p.lastName ?? ''}`.trim() : null;
const idOf = (ref: Types.ObjectId | { _id: Types.ObjectId }) =>
  ('_id' in ref ? ref._id : ref).toString();

/** Only the last four characters of a card slip / UPI / claim reference ('••••4821'). */
export function maskReference(reference?: string | null): string | null {
  if (!reference) return null;
  return reference.length <= 4 ? reference : `••••${reference.slice(-4)}`;
}

/**
 * A payment or refund. Staff see the full reference, the reason and who received it; patients
 * the masked reference only. Payments also carry what has been refunded of them.
 */
export function toPaymentView(
  p: PaymentLike,
  role: Role,
  refundedPaise = 0,
): Record<string, unknown> {
  const staff = role !== ROLES.PATIENT;
  return {
    id: p._id.toString(),
    paymentNumber: p.paymentNumber,
    invoiceId: idOf(p.invoice),
    kind: p.kind,
    amountPaise: p.amountPaise,
    method: p.method,
    reference: staff ? (p.reference ?? null) : maskReference(p.reference),
    refundOf: p.refundOf?.toString() ?? null,
    receivedAt: p.receivedAt,
    ...(p.kind === 'payment'
      ? { refundedPaise, refundablePaise: p.amountPaise - refundedPaise }
      : {}),
    ...(staff ? { reason: p.reason ?? null, receivedByName: nameOf(p.receivedBy) } : {}),
  };
}

/** 'Rahul V.' – first name and the initial of the last name (the day summary). */
export const shortName = (p: Types.ObjectId | PersonRef | null | undefined) =>
  p && 'firstName' in p && p.firstName
    ? `${p.firstName} ${p.lastName ? `${p.lastName[0]}.` : ''}`.trim()
    : null;
