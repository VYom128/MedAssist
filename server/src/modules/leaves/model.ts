import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { LEAVE_TYPES } from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/**
 * Doctor leave (spec §6.10): `[startAt, endAt)` in UTC, end exclusive (a full day ends at the
 * next clinic midnight). Cancelled, never deleted.
 */
const doctorLeaveSchema = new Schema(
  {
    doctor: { type: ObjectId, ref: 'User', required: true }, // the doctor's User id
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    type: { type: String, enum: LEAVE_TYPES, default: 'leave' },
    reason: { type: String, trim: true, maxlength: 500 },
    isCancelled: { type: Boolean, default: false },
    cancelledAt: Date,
    cancelledBy: { type: ObjectId, ref: 'User' },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'doctor_leaves' },
);

doctorLeaveSchema.index({ doctor: 1, isCancelled: 1, startAt: 1, endAt: 1 });

export type DoctorLeaveDoc = InferSchemaType<typeof doctorLeaveSchema>;

const createModel = () => mongoose.model('DoctorLeave', doctorLeaveSchema);
export type DoctorLeaveModel = ReturnType<typeof createModel>;

export const DoctorLeave: DoctorLeaveModel =
  (mongoose.models.DoctorLeave as DoctorLeaveModel | undefined) ?? createModel();
