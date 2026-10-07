import { Types, type ClientSession } from 'mongoose';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { PLACED_LAB_ORDER } from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition } from '../../utils/stateMachine.js';
import { Appointment } from '../appointments/model.js';
import { LabOrder } from '../labOrders/model.js';
import { getSettings } from '../settings/service.js';
import {
  consultationLine,
  defaultTaxRateBps,
  labTestLines,
  totalsOf,
  type PricedLine,
} from './lines.js';
import { Invoice } from './model.js';
import { resourceOf } from './serializer.js';

/**
 * Automatic invoice changes (Phase 7 decisions), always INSIDE the caller's transaction so the
 * invoice commits (or rolls back) with what caused it:
 * - signing a note → the appointment's draft invoice: a consultation line + one line per placed
 *   lab test (createOrUpdateDraftForAppointment);
 * - a lab order placed after signing → its lines on the appointment's draft, or a supplementary
 *   draft when the invoice was already issued (addLabOrderToInvoice);
 * - a cancelled lab test → its line removed from a draft, or listed in `cancelledItemsBilled`
 *   of an issued invoice, which is never changed automatically (removeOrFlagCancelledLabItems);
 * - a cancelled appointment → its draft invoice voided (voidDraftInvoicesForAppointment).
 * All are idempotent: lines are matched by lab order item (and one consultation per visit), so
 * running one twice adds nothing. The discount rule does not apply (no discounts are added).
 * Audit with `afterInvoiceSync` once the transaction has committed.
 */

export type SyncAction = 'created' | 'updated' | 'flagged' | 'voided';

export interface SyncResult {
  invoice: { _id: Types.ObjectId; invoiceNumber?: string | null; patient: Types.ObjectId };
  action: SyncAction;
  linesAdded: number;
  linesRemoved: number;
  flagged: number;
  totalPaise: number;
}

interface SyncOptions {
  session: ClientSession;
  by: string;
  now?: Date;
}

const stale = () => ApiError.conflict('The invoice changed at the same time. Please try again.');

const history = (status: string, by: string, at: Date, note?: string) => ({
  status,
  at,
  by,
  ...(note ? { note } : {}),
});

/** The lines (consultation, placed lab tests) of an appointment not yet on a live invoice. */
async function unbilledLines(
  appt: {
    _id: Types.ObjectId;
    service?: Types.ObjectId | null;
    serviceSnapshot: { name: string; pricePaise: number };
  },
  invoices: { items: { kind: string; labOrderItem?: Types.ObjectId | null }[] }[],
  session: ClientSession,
): Promise<PricedLine[]> {
  const billedItems = new Set(
    invoices.flatMap((i) => i.items.map((l) => l.labOrderItem?.toString()).filter(Boolean)),
  );
  const consultationBilled = invoices.some((i) => i.items.some((l) => l.kind === 'consultation'));
  const lines: PricedLine[] = [];
  if (!consultationBilled) lines.push(await consultationLine(appt, session));

  const orders = await LabOrder.find({
    appointment: appt._id,
    ...PLACED_LAB_ORDER,
    status: { $ne: 'cancelled' },
  })
    .select('items._id items.test items.testSnapshot items.status orderedAt')
    .sort({ orderedAt: 1, _id: 1 })
    .session(session)
    .lean();
  const tax = await defaultTaxRateBps();
  for (const order of orders) {
    const items = order.items.filter(
      (i) => i.status !== 'cancelled' && !billedItems.has(i._id.toString()),
    );
    if (items.length > 0) lines.push(...labTestLines({ _id: order._id, items }, tax));
  }
  return lines;
}

/**
 * Creates or updates the appointment's draft invoice with what is not billed yet: the
 * consultation (unless a live invoice of the visit already has one) and every placed,
 * uncancelled lab test (unless already on a live invoice). Adds to the visit's draft if there is
 * one; otherwise creates the appointment invoice, or a supplementary one when a live invoice
 * already exists (issued). @returns what changed, or null when everything is billed already.
 */
export async function createOrUpdateDraftForAppointment(
  appointmentId: Types.ObjectId | string,
  { session, by, now = new Date() }: SyncOptions,
): Promise<SyncResult | null> {
  const appt = await Appointment.findById(appointmentId)
    .select('patient service serviceSnapshot')
    .session(session)
    .lean();
  if (!appt) throw ApiError.notFound('Appointment not found');
  const invoices = await Invoice.find({ appointment: appt._id, status: { $ne: 'void' } })
    .select('status items __v invoiceNumber patient')
    .session(session)
    .lean();
  const added = await unbilledLines(appt, invoices, session);
  if (added.length === 0) return null;

  const draft = invoices.find((i) => i.status === 'draft');
  if (draft) {
    const items = [...(draft.items as unknown as PricedLine[]), ...added];
    const totals = totalsOf(items);
    const updated = await Invoice.findOneAndUpdate(
      { _id: draft._id, status: 'draft', __v: draft.__v },
      { $set: { items, ...totals, updatedBy: by }, $inc: { __v: 1 } },
      { new: true, session, runValidators: true },
    ).lean();
    if (!updated) throw stale();
    return {
      invoice: { _id: updated._id, patient: updated.patient },
      action: 'updated',
      linesAdded: added.length,
      linesRemoved: 0,
      flagged: 0,
      totalPaise: updated.totalPaise,
    };
  }

  const settings = await getSettings();
  const [created] = await Invoice.create(
    [
      {
        kind: invoices.length > 0 ? 'supplementary' : 'appointment',
        patient: appt.patient,
        appointment: appt._id,
        status: 'draft',
        items: added,
        ...totalsOf(added),
        currency: settings.currency ?? 'INR',
        statusHistory: [history('draft', by, now)],
        createdBy: by,
        updatedBy: by,
      },
    ],
    { session },
  );
  return {
    invoice: { _id: created!._id, patient: created!.patient },
    action: 'created',
    linesAdded: added.length,
    linesRemoved: 0,
    flagged: 0,
    totalPaise: created!.totalPaise,
  };
}

/**
 * A lab order placed after the note was signed: its tests go on the appointment's draft invoice,
 * or a supplementary draft when the invoice was already issued (same rules as signing).
 */
export async function addLabOrderToInvoice(
  order: { appointment: Types.ObjectId },
  options: SyncOptions,
): Promise<SyncResult | null> {
  return createOrUpdateDraftForAppointment(order.appointment, options);
}

/**
 * Lab tests cancelled (single items, or every item of a cancelled order): on a draft invoice
 * their lines are removed and the totals recomputed; on an issued invoice (any status but void)
 * the lines stay and are listed in `cancelledItemsBilled` for reception to refund. Each item is
 * listed once.
 */
export async function removeOrFlagCancelledLabItems(
  orderId: Types.ObjectId,
  itemIds: readonly (Types.ObjectId | string)[],
  { session, by, now = new Date() }: SyncOptions,
): Promise<SyncResult[]> {
  if (itemIds.length === 0) return [];
  const ids = itemIds.map((id) => new Types.ObjectId(id.toString()));
  const wanted = new Set(ids.map((id) => id.toString()));
  const invoices = await Invoice.find({
    status: { $ne: 'void' },
    'items.labOrderItem': { $in: ids },
  })
    .session(session)
    .lean();

  const results: SyncResult[] = [];
  for (const inv of invoices) {
    const items = inv.items as unknown as PricedLine[];
    const lines = items.filter((l) => l.labOrderItem && wanted.has(l.labOrderItem.toString()));
    if (inv.status === 'draft') {
      const remaining = items.filter((l) => !lines.includes(l));
      const totals = totalsOf(remaining);
      const updated = await Invoice.findOneAndUpdate(
        { _id: inv._id, status: 'draft', __v: inv.__v },
        { $set: { items: remaining, ...totals, updatedBy: by }, $inc: { __v: 1 } },
        { new: true, session, runValidators: true },
      ).lean();
      if (!updated) throw stale();
      results.push({
        invoice: { _id: inv._id, patient: inv.patient },
        action: 'updated',
        linesAdded: 0,
        linesRemoved: lines.length,
        flagged: 0,
        totalPaise: updated.totalPaise,
      });
      continue;
    }
    const already = new Set(inv.cancelledItemsBilled.map((c) => c.itemId.toString()));
    const toFlag = lines.filter((l) => !already.has(l.labOrderItem!.toString()));
    if (toFlag.length === 0) continue;
    await Invoice.updateOne(
      { _id: inv._id, status: { $ne: 'void' } },
      {
        $push: {
          cancelledItemsBilled: {
            $each: toFlag.map((l) => ({
              lineId: l._id,
              description: l.description,
              lineTotalPaise: l.lineTotalPaise,
              labOrderId: l.labOrder ?? orderId,
              itemId: l.labOrderItem!,
              at: now,
            })),
          },
        },
        $set: { updatedBy: by },
        $inc: { __v: 1 },
      },
      { session },
    );
    results.push({
      invoice: { _id: inv._id, invoiceNumber: inv.invoiceNumber, patient: inv.patient },
      action: 'flagged',
      linesAdded: 0,
      linesRemoved: 0,
      flagged: toFlag.length,
      totalPaise: inv.totalPaise,
    });
  }
  return results;
}

/** A cancelled appointment: its draft invoices become void (spec §8.3). */
export async function voidDraftInvoicesForAppointment(
  appointmentId: Types.ObjectId,
  { session, by, now = new Date(), reason }: SyncOptions & { reason: string },
): Promise<SyncResult[]> {
  const drafts = await Invoice.find({ appointment: appointmentId, status: 'draft' })
    .select('_id patient totalPaise status')
    .session(session)
    .lean();
  const results: SyncResult[] = [];
  for (const d of drafts) {
    assertTransition('invoice', d.status, 'void');
    const updated = await Invoice.updateOne(
      { _id: d._id, status: 'draft' },
      {
        $set: { status: 'void', void: { by, at: now, reason }, updatedBy: by },
        $push: { statusHistory: history('void', by, now, reason) },
        $inc: { __v: 1 },
      },
      { session },
    );
    if (updated.modifiedCount === 0) throw stale();
    results.push({
      invoice: { _id: d._id, patient: d.patient },
      action: 'voided',
      linesAdded: 0,
      linesRemoved: 0,
      flagged: 0,
      totalPaise: d.totalPaise,
    });
  }
  return results;
}

const ACTION_FOR: Record<SyncAction, (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]> = {
  created: AUDIT_ACTIONS.INVOICE_CREATE,
  updated: AUDIT_ACTIONS.INVOICE_SYNC,
  flagged: AUDIT_ACTIONS.INVOICE_SYNC,
  voided: AUDIT_ACTIONS.INVOICE_VOID,
};

/** After the commit: one audit entry per invoice the sync changed (`via` = what caused it). */
export async function afterInvoiceSync(
  user: AuthUser,
  results: readonly (SyncResult | null)[],
  meta: RequestMeta,
  via: 'sign' | 'lab_order' | 'lab_cancel' | 'appointment_cancel',
): Promise<void> {
  for (const r of results) {
    if (!r) continue;
    await audit.record({
      action: ACTION_FOR[r.action],
      actor: actorOf(user),
      resource: resourceOf(r.invoice),
      patient: r.invoice.patient,
      request: meta,
      metadata: {
        via,
        system: true,
        linesAdded: r.linesAdded,
        linesRemoved: r.linesRemoved,
        cancelledItemsFlagged: r.flagged,
        totalPaise: r.totalPaise,
        ...(r.action === 'voided' ? { fromStatus: 'draft' } : {}),
      },
    });
  }
}
