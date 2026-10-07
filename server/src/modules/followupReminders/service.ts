import type { ClientSession, Types } from 'mongoose';
import { calendarDate } from '../../utils/dates.js';
import { followUpDueDate } from '../encounters/followUp.js';
import { FollowupReminder } from './model.js';

/** The note fields a reminder is made from. */
export interface PlannedNoteRef {
  _id: Types.ObjectId;
  appointment: Types.ObjectId;
  patient: Types.ObjectId | { _id: Types.ObjectId };
  doctor: Types.ObjectId | { _id: Types.ObjectId };
  visitAt: Date;
  signedAt?: Date | null;
  followUp?: { required?: boolean | null; afterDays?: number | null; date?: Date | null } | null;
}

const idOf = (ref: Types.ObjectId | { _id: Types.ObjectId }) => ('_id' in ref ? ref._id : ref);

/**
 * Keeps the note's follow-up reminder in step with its plan, inside the caller's transaction
 * (the sign transaction – this replaces the Phase 5 TODO – and amendments):
 * - a plan with a due date → a 'pending' reminder for that date (created, or its date updated);
 * - no plan (any more) → a pending reminder is skipped ('cancelled').
 * A reminder that was already sent is never touched again, so it is never sent twice.
 */
export async function syncFollowUpReminder(
  e: PlannedNoteRef,
  { session, timezone }: { session?: ClientSession; timezone: string },
): Promise<void> {
  const due = followUpDueDate(e, timezone);
  const existing = await FollowupReminder.findOne({ encounter: e._id })
    .select('status')
    .session(session ?? null)
    .lean();
  if (!existing) {
    if (!due) return;
    await FollowupReminder.create(
      [
        {
          encounter: e._id,
          appointment: e.appointment,
          patient: idOf(e.patient),
          doctor: idOf(e.doctor),
          visitAt: e.visitAt,
          dueDate: calendarDate(due),
        },
      ],
      { session },
    );
    return;
  }
  if (existing.status === 'sent') return;
  await FollowupReminder.updateOne(
    { _id: existing._id, status: { $ne: 'sent' } },
    due
      ? { $set: { dueDate: calendarDate(due), status: 'pending' }, $unset: { skipReason: '' } }
      : { $set: { status: 'skipped', skipReason: 'cancelled' } },
    { session },
  );
}
