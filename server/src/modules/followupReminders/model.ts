import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { FOLLOWUP_REMINDER_STATUSES } from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * The reminder state of a signed note's follow-up plan (spec §8.11, Phase 8). Signed notes are
 * immutable, so whether the reminder went out lives here: one per encounter, written in the sign
 * transaction (and kept in step by amendments while still pending). `dueDate` is the clinic date
 * the follow-up is due. The daily job claims `pending` reminders due in two days by setting
 * `status` (sent or skipped) with a conditional update, so one is never sent twice.
 */
const followupReminderSchema = new Schema(
  {
    encounter: { type: ObjectId, ref: 'Encounter', required: true, immutable: true },
    appointment: { type: ObjectId, ref: 'Appointment', required: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    doctor: { type: ObjectId, ref: 'User', required: true, immutable: true },
    /** The visit's start: a later appointment with the doctor counts as booked. */
    visitAt: { type: Date, required: true, immutable: true },
    /** A clinic calendar date (UTC midnight, see `calendarDate`). */
    dueDate: { type: Date, required: true },
    status: { type: String, enum: FOLLOWUP_REMINDER_STATUSES, default: 'pending', required: true },
    /** Why it was not sent: 'booked' (already booked), 'no_contact' (no email), 'cancelled'. */
    skipReason: String,
    sentAt: Date,
  },
  { timestamps: true, collection: 'followup_reminders' },
);

followupReminderSchema.index({ encounter: 1 }, { unique: true });
followupReminderSchema.index({ status: 1, dueDate: 1 });

export type FollowupReminderDoc = InferSchemaType<typeof followupReminderSchema>;

const createModel = () => mongoose.model('FollowupReminder', followupReminderSchema);
export type FollowupReminderModel = ReturnType<typeof createModel>;

export const FollowupReminder: FollowupReminderModel =
  (mongoose.models.FollowupReminder as FollowupReminderModel | undefined) ?? createModel();
