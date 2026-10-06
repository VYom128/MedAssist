import { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';
import { canAccessPatient } from './patientAccess.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref: Ref) => ('_id' in ref ? ref._id : ref).toString();

export interface InvoiceRefs {
  _id: Types.ObjectId;
  patient: Ref;
  status: string;
}

/**
 * Who may read an invoice (spec §2.4 "Invoices & payments", §7.15):
 * - receptionists and admins: every invoice (billing scope);
 * - the patient: their own, once issued (never drafts);
 * - doctors and lab technicians: none in v1 (the doctor "summary" of §2.4 is deferred).
 */
export async function canReadInvoice(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  invoice: InvoiceRefs,
): Promise<boolean> {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return canAccessPatient(user, idOf(invoice.patient), 'billing');
    case ROLES.PATIENT:
      return (
        invoice.status !== 'draft' &&
        user.patientId !== null &&
        idOf(invoice.patient) === user.patientId
      );
    default:
      return false;
  }
}

/** 404 (never 403, spec §10.2) unless `user` may read the invoice; denials are audited. */
export async function assertCanReadInvoice(
  user: AuthUser,
  invoice: InvoiceRefs,
  request?: RequestMeta,
): Promise<void> {
  if (await canReadInvoice(user, invoice)) return;
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'invoice', id: invoice._id },
    patient: idOf(invoice.patient),
    request,
    metadata: { reason: 'invoice_access' },
  });
  throw ApiError.notFound('Invoice not found');
}

/**
 * The base list filter per role (GET /invoices): everything for reception and admins; the
 * patient's own issued invoices (`patientId` = their linked record); nothing otherwise.
 */
export function invoiceListFilter(
  user: Pick<AuthUser, 'role'>,
  patientId?: string | null,
): Record<string, unknown> {
  if (user.role === ROLES.ADMIN || user.role === ROLES.RECEPTIONIST) return {};
  if (user.role === ROLES.PATIENT && patientId) {
    return { patient: new Types.ObjectId(patientId), status: { $ne: 'draft' } };
  }
  return { _id: { $in: [] } };
}
