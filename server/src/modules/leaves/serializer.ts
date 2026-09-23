import type { Types } from 'mongoose';
import type { DoctorLeaveDoc } from './model.js';

export type LeaveLike = DoctorLeaveDoc & { _id: Types.ObjectId; createdAt?: Date };

/** Leave is visible to admins, receptionists and the doctor (spec §7.6). */
export function toLeaveView(l: LeaveLike) {
  return {
    id: l._id.toString(),
    doctorId: l.doctor.toString(),
    startAt: l.startAt,
    endAt: l.endAt,
    type: l.type,
    reason: l.reason ?? null,
    isCancelled: l.isCancelled,
    cancelledAt: l.cancelledAt ?? null,
    createdAt: l.createdAt ?? null,
  };
}
