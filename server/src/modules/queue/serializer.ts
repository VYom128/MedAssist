import type { Types } from 'mongoose';

/**
 * Queue views (spec §4.6, §7.9). Staff and the doctor see a short patient name and the MRN; the
 * kiosk board sees tokens, doctor names and rooms only – never patient names or any ids.
 */

export interface QueueAppointment {
  _id: Types.ObjectId;
  appointmentNumber: string;
  status: string;
  type: string;
  priority: string;
  isOverbook?: boolean | null;
  startAt: Date;
  patient: { _id: Types.ObjectId; firstName: string; lastName: string; mrn: string };
  queue?: {
    tokenNumber?: number | null;
    checkedInAt?: Date | null;
    calledAt?: Date | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  } | null;
}

const minutesBetween = (from?: Date | null, to?: Date | null) =>
  from && to ? Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000)) : null;

/** One queue row for staff and the doctor. */
export function toQueueItem(
  a: QueueAppointment,
  now: Date,
  extra: { position?: number; estimatedWaitMinutes?: number } = {},
) {
  const q = a.queue ?? {};
  const waiting = a.status === 'checked_in';
  return {
    appointmentId: a._id.toString(),
    appointmentNumber: a.appointmentNumber,
    tokenNumber: q.tokenNumber ?? null,
    status: a.status,
    patient: {
      id: a.patient._id.toString(),
      shortName: `${a.patient.firstName} ${a.patient.lastName.charAt(0)}.`,
      mrn: a.patient.mrn,
    },
    priority: a.priority,
    type: a.type,
    isOverbook: Boolean(a.isOverbook),
    scheduledAt: a.startAt,
    checkedInAt: q.checkedInAt ?? null,
    calledAt: q.calledAt ?? null,
    startedAt: q.startedAt ?? null,
    completedAt: q.completedAt ?? null,
    /** Minutes waited so far (waiting), or waited before being seen. */
    waitMinutes: minutesBetween(q.checkedInAt, waiting ? now : q.startedAt),
    position: waiting ? (extra.position ?? null) : null,
    estimatedWaitMinutes: waiting ? (extra.estimatedWaitMinutes ?? null) : null,
  };
}
