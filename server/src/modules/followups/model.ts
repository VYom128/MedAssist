import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  FOLLOWUP_MESSAGE_VISIBILITIES,
  FOLLOWUP_REQUEST_STATUSES,
  FOLLOWUP_REQUEST_TYPES,
  FOLLOWUP_RULES,
  ROLE_VALUES,
} from '../../config/constants.js';

const { ObjectId } = Schema.Types;

const messageSchema = new Schema(
  {
    from: { type: ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLE_VALUES, required: true },
    text: { type: String, required: true, trim: true, maxlength: FOLLOWUP_RULES.messageMax },
    /** 'staff' = an internal note: never shown to the patient. */
    visibility: { type: String, enum: FOLLOWUP_MESSAGE_VISIBILITIES, default: 'all' },
    at: { type: Date, required: true },
  },
  { _id: true },
);

const statusEntrySchema = new Schema(
  {
    status: { type: String, enum: FOLLOWUP_REQUEST_STATUSES, required: true },
    at: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User' },
    note: { type: String, trim: true, maxlength: FOLLOWUP_RULES.reasonMax },
  },
  { _id: false },
);

/**
 * A patient's follow-up request (spec §6.18, §4.10): a question, new symptoms, a report to
 * review, a refill or a reschedule, triaged by reception and the assigned doctor. Numbers
 * 'FUR-<clinic year>-000001'. Status changes only through the service (transition table
 * `STATE_MACHINES.followupRequest`, conditional updates). Messages are a thread; 'staff' messages
 * are internal notes. Never deleted.
 */
const followupRequestSchema = new Schema(
  {
    requestNumber: { type: String, required: true, trim: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true, immutable: true },
    relatedAppointment: { type: ObjectId, ref: 'Appointment', immutable: true },
    assignedDoctor: { type: ObjectId, ref: 'User' },
    type: { type: String, enum: FOLLOWUP_REQUEST_TYPES, required: true, immutable: true },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: FOLLOWUP_RULES.messageMax,
      immutable: true,
    },
    /** A clinic calendar date (UTC midnight, see `calendarDate`). */
    preferredDate: Date,
    attachments: { type: [{ type: ObjectId, ref: 'Document' }], default: [] },
    status: { type: String, enum: FOLLOWUP_REQUEST_STATUSES, default: 'open', required: true },
    messages: { type: [messageSchema], default: [] },
    resultingAppointment: { type: ObjectId, ref: 'Appointment' },
    closedReason: { type: String, trim: true, maxlength: FOLLOWUP_RULES.reasonMax },
    statusHistory: { type: [statusEntrySchema], default: [] },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'followup_requests' },
);

followupRequestSchema.index({ requestNumber: 1 }, { unique: true });
followupRequestSchema.index({ patient: 1, createdAt: -1 });
followupRequestSchema.index({ status: 1, createdAt: -1 });
followupRequestSchema.index({ assignedDoctor: 1, status: 1 });

const deleteRefused = () => {
  throw new Error('Follow-up requests are never deleted');
};
followupRequestSchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
followupRequestSchema.pre('deleteOne', { document: true, query: true }, deleteRefused);

export type FollowupRequestDoc = InferSchemaType<typeof followupRequestSchema>;

const createModel = () => mongoose.model('FollowupRequest', followupRequestSchema);
export type FollowupRequestModel = ReturnType<typeof createModel>;

export const FollowupRequest: FollowupRequestModel =
  (mongoose.models.FollowupRequest as FollowupRequestModel | undefined) ?? createModel();
