import type { ClientSession, Types, UpdateQuery } from 'mongoose';
import type { LabOrderStatus } from '../../config/constants.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { LabOrder, type LabOrderDoc } from './model.js';
import { derivedOrderStatus } from './status.js';

/**
 * Every lab order status change goes through here (spec §5.4, like appointments'
 * applyTransition): assertTransition, one conditional update on the current status (a
 * concurrent change makes the loser's update miss → 409 INVALID_STATUS_TRANSITION), and a
 * `statusHistory` entry. Audit and events are the caller's job, after the commit.
 */

export const historyEntry = (
  status: LabOrderStatus,
  by: string | null,
  note?: string,
  at = new Date(),
) => ({ status, at, ...(by ? { by } : {}), ...(note ? { note } : {}) });

export interface TransitionOptions {
  session?: ClientSession;
  /** Extra update operators applied with the status change (e.g. `$unset`). */
  extra?: Omit<UpdateQuery<LabOrderDoc>, '$set'>;
  /** Query options (e.g. revisionWriteOptions for released orders). */
  queryOptions?: Record<string, unknown>;
  at?: Date;
}

export type LabOrderLean = LabOrderDoc & { _id: Types.ObjectId; __v?: number };

export async function applyOrderTransition(
  order: { _id: Types.ObjectId; status: string },
  to: LabOrderStatus,
  set: Record<string, unknown>,
  by: string | null,
  note: string | undefined,
  { session, extra = {}, queryOptions = {}, at = new Date() }: TransitionOptions = {},
): Promise<LabOrderLean> {
  assertTransition('labOrder', order.status, to);
  const updated = await LabOrder.findOneAndUpdate(
    { _id: order._id, status: order.status },
    {
      ...extra,
      $set: { ...set, status: to, ...(by ? { updatedBy: by } : {}) },
      $push: { statusHistory: historyEntry(to, by, note, at) },
      $inc: { __v: 1 },
    },
    { new: true, session, ...queryOptions },
  ).lean();
  if (!updated) {
    const fresh = await LabOrder.findById(order._id)
      .select('status')
      .session(session ?? null)
      .lean();
    throw invalidTransition('labOrder', fresh?.status ?? order.status, to);
  }
  return updated as LabOrderLean;
}

/**
 * Re-derives the order status from its items (derivedOrderStatus) and applies a change, if
 * any. @returns the order's status afterwards.
 */
export async function recomputeOrderStatus(
  orderId: Types.ObjectId,
  { by, session, note }: { by: string | null; session?: ClientSession; note?: string },
): Promise<LabOrderStatus> {
  const order = await LabOrder.findById(orderId)
    .select('status items.status')
    .session(session ?? null)
    .lean();
  if (!order) throw new Error(`Lab order ${orderId.toString()} vanished`);
  const next = derivedOrderStatus(order);
  if (next === order.status) return next;
  await applyOrderTransition(order, next, {}, by, note, { session });
  return next;
}
