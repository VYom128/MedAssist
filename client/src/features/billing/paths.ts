import { ROLES, type Role } from '../../constants/roles';
import type { Invoice, Payment } from './api';

/** Where a role's invoice pages live. */
export const invoicesBase = (role: Role | undefined) =>
  role === ROLES.ADMIN
    ? '/admin/invoices'
    : role === ROLES.PATIENT
      ? '/patient/invoices'
      : '/reception/invoices';

const desk = (role: Role | undefined) => role === ROLES.RECEPTIONIST || role === ROLES.ADMIN;

/**
 * What a role may do with an invoice (mirrors the server; it decides anyway):
 * reception and admins edit drafts and void; reception issues and takes payments (admins issue
 * too); refunds by both.
 */
export function invoiceActions(
  role: Role | undefined,
  inv: Pick<Invoice, 'status' | 'amountPaidPaise' | 'balancePaise'>,
) {
  const open = inv.status === 'issued' || inv.status === 'partially_paid';
  return {
    edit: desk(role) && inv.status === 'draft',
    issue: desk(role) && inv.status === 'draft',
    pay: role === ROLES.RECEPTIONIST && open && inv.balancePaise > 0,
    refund: desk(role) && inv.status !== 'draft' && inv.status !== 'void',
    void: desk(role) && (inv.status === 'draft' || open || inv.status === 'paid'),
    /** Void is offered but blocked while money is held. */
    voidBlocked: inv.amountPaidPaise > 0,
    pdf: inv.status !== 'draft',
  };
}

/** Payments with their refunds nested under them (refunds point at the original). */
export function groupPayments(payments: readonly Payment[]) {
  const refunds = new Map<string, Payment[]>();
  for (const p of payments) {
    if (p.kind === 'refund' && p.refundOf) {
      refunds.set(p.refundOf, [...(refunds.get(p.refundOf) ?? []), p]);
    }
  }
  return payments
    .filter((p) => p.kind === 'payment')
    .map((payment) => ({ payment, refunds: refunds.get(payment.id) ?? [] }));
}
