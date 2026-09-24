import mongoose, { Schema, type InferSchemaType, type UpdateQuery } from 'mongoose';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  APPOINTMENT_RULES,
  type AppointmentStatus,
} from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * Whether an appointment holds its slot in the partial unique index `{ doctor, startAt }`: every
 * status except cancelled and no-show, and never for overbooked walk-ins (spec §6.12).
 */
export function slotActiveFor(status: AppointmentStatus, isOverbook = false): boolean {
  return !isOverbook && status !== 'cancelled' && status !== 'no_show';
}

const serviceSnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    pricePaise: { type: Number, required: true },
  },
  { _id: false },
);

const queueSchema = new Schema(
  {
    tokenNumber: Number,
    checkedInAt: Date,
    calledAt: Date,
    startedAt: Date,
    completedAt: Date,
  },
  { _id: false },
);

const cancellationSchema = new Schema(
  {
    by: { type: ObjectId, ref: 'User' },
    byRole: String,
    at: Date,
    reason: { type: String, trim: true, maxlength: APPOINTMENT_RULES.reasonMaxLength },
  },
  { _id: false },
);

const rescheduleSchema = new Schema(
  {
    fromStartAt: { type: Date, required: true },
    toStartAt: { type: Date, required: true },
    fromDoctor: { type: ObjectId, ref: 'User' },
    toDoctor: { type: ObjectId, ref: 'User' },
    by: { type: ObjectId, ref: 'User' },
    byRole: String,
    at: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: APPOINTMENT_RULES.reasonMaxLength },
  },
  { _id: false },
);

const statusHistorySchema = new Schema(
  {
    status: { type: String, enum: APPOINTMENT_STATUSES, required: true },
    at: { type: Date, required: true },
    by: { type: ObjectId, ref: 'User' }, // null = system (jobs)
    note: { type: String, trim: true, maxlength: APPOINTMENT_RULES.reasonMaxLength },
  },
  { _id: false },
);

/**
 * Appointment (spec §6.12). `doctor` is the doctor's **User id** (D41). `[startAt, endAt)` in
 * UTC. `isSlotActive` is derived from status and `isOverbook` (see `slotActiveFor`): document
 * saves recompute it, and update queries that change `status` must set it too (enforced below).
 */
const appointmentSchema = new Schema(
  {
    appointmentNumber: { type: String, required: true, unique: true, immutable: true },
    patient: { type: ObjectId, ref: 'Patient', required: true },
    doctor: { type: ObjectId, ref: 'User', required: true },
    department: { type: ObjectId, ref: 'Department' },
    service: { type: ObjectId, ref: 'Service' },
    serviceSnapshot: { type: serviceSnapshotSchema, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    type: { type: String, enum: APPOINTMENT_TYPES, default: 'new' },
    source: { type: String, enum: APPOINTMENT_SOURCES, required: true },
    reason: { type: String, trim: true, maxlength: APPOINTMENT_RULES.reasonMaxLength },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled', required: true },
    isSlotActive: { type: Boolean, default: true },
    priority: { type: String, enum: APPOINTMENT_PRIORITIES, default: 'normal' },
    queue: { type: queueSchema, default: () => ({}) },
    cancellation: cancellationSchema,
    rescheduleHistory: { type: [rescheduleSchema], default: [] },
    followUpOf: { type: ObjectId, ref: 'Appointment' },
    isOverbook: { type: Boolean, default: false },
    reminderSentAt: Date,
    statusHistory: { type: [statusHistorySchema], default: [] },
    bookedBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

appointmentSchema.pre('validate', function syncSlotActive() {
  this.isSlotActive = slotActiveFor(this.status as AppointmentStatus, this.isOverbook);
});

/** Update queries that change `status` must also set `isSlotActive` (use `slotActiveFor`). */
appointmentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function guardSlotActive() {
  const update = this.getUpdate() as UpdateQuery<unknown> | null;
  if (!update || Array.isArray(update)) return;
  const set = (update.$set ?? {}) as Record<string, unknown>;
  const changesStatus = 'status' in set || 'status' in update;
  const setsSlot = 'isSlotActive' in set || 'isSlotActive' in update;
  if (changesStatus && !setsSlot) {
    throw new Error('Appointment status updates must also set isSlotActive (slotActiveFor)');
  }
});

// Spec §6.12 indexes. The partial unique index is the final guard against double-booking a slot
// (overbooked walk-ins, cancellations and no-shows have isSlotActive: false and are not in it).
appointmentSchema.index(
  { doctor: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { isSlotActive: true } },
);
appointmentSchema.index({ patient: 1, startAt: -1 });
appointmentSchema.index({ doctor: 1, status: 1, startAt: 1 });
appointmentSchema.index({ status: 1, startAt: 1 }); // no-show and reminder jobs

export type AppointmentDoc = InferSchemaType<typeof appointmentSchema>;

const createModel = () => mongoose.model('Appointment', appointmentSchema);
export type AppointmentModel = ReturnType<typeof createModel>;

export const Appointment: AppointmentModel =
  (mongoose.models.Appointment as AppointmentModel | undefined) ?? createModel();
