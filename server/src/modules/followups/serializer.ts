import type { Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants.js';
import { calendarDateString } from '../../utils/dates.js';
import type { FollowupRequestDoc } from './model.js';

/**
 * Follow-up request views (spec §7.13): staff (reception, admins, the assigned doctor) see the
 * whole thread incl. internal notes; the patient never sees 'staff' messages nor who changed
 * what internally. List rows carry no message text (not audited per row).
 */

interface PersonRef {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

export type FollowupLike = Omit<
  FollowupRequestDoc,
  'patient' | 'assignedDoctor' | 'messages' | 'attachments'
> & {
  _id: Types.ObjectId;
  patient: PersonRef & { mrn?: string };
  assignedDoctor?: PersonRef | null;
  attachments?: (
    | Types.ObjectId
    | (PersonRef & { title?: string; category?: string; mimeType?: string; sizeBytes?: number })
  )[];
  messages?: {
    _id: Types.ObjectId;
    from?: PersonRef | Types.ObjectId | null;
    role: string;
    text: string;
    visibility: string;
    at: Date;
  }[];
  createdAt?: Date;
  updatedAt?: Date;
};

export const FOLLOWUP_POPULATE = [
  { path: 'patient', select: 'mrn firstName lastName' },
  { path: 'assignedDoctor', select: 'firstName lastName' },
  { path: 'messages.from', select: 'firstName lastName' },
  { path: 'attachments', select: 'title category mimeType sizeBytes isDeleted' },
] as const;

export const FOLLOWUP_LIST_POPULATE = [
  { path: 'patient', select: 'mrn firstName lastName' },
  { path: 'assignedDoctor', select: 'firstName lastName' },
] as const;

export const resourceOf = (r: { _id: Types.ObjectId; requestNumber: string }) => ({
  type: 'followup_request',
  id: r._id,
  number: r.requestNumber,
});

const idOf = (ref?: { _id: Types.ObjectId } | Types.ObjectId | null) =>
  ref ? ('_id' in ref ? ref._id : ref).toString() : null;
const nameOf = (p?: PersonRef | Types.ObjectId | null) =>
  p && 'firstName' in p && p.firstName ? `${p.firstName} ${p.lastName ?? ''}`.trim() : null;
const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

const isStaff = (role: Role) => role !== ROLES.PATIENT;

function visibleMessages(r: FollowupLike, role: Role) {
  return (r.messages ?? []).filter((m) => isStaff(role) || m.visibility === 'all');
}

function core(r: FollowupLike, role: Role) {
  const messages = visibleMessages(r, role);
  return {
    id: r._id.toString(),
    requestNumber: r.requestNumber,
    type: r.type,
    status: r.status,
    patient: {
      id: r.patient._id.toString(),
      mrn: orNull(r.patient.mrn),
      fullName: nameOf(r.patient),
    },
    assignedDoctor: r.assignedDoctor
      ? { id: r.assignedDoctor._id.toString(), name: nameOf(r.assignedDoctor) }
      : null,
    relatedAppointmentId: idOf(r.relatedAppointment),
    resultingAppointmentId: idOf(r.resultingAppointment),
    preferredDate: r.preferredDate ? calendarDateString(r.preferredDate) : null,
    messageCount: messages.length,
    lastMessageAt: messages.at(-1)?.at ?? null,
    createdAt: orNull(r.createdAt),
    updatedAt: orNull(r.updatedAt),
  };
}

/** One row of GET /follow-up-requests: no message text. */
export function toListItem(r: FollowupLike, role: Role) {
  return core(r, role);
}

/** The full request for `role`: the thread (patients: without internal notes). */
export function toView(r: FollowupLike, role: Role) {
  const staff = isStaff(role);
  return {
    ...core(r, role),
    message: r.message,
    attachments: (r.attachments ?? [])
      .filter((a) => !('isDeleted' in a && a.isDeleted))
      .map((a) => ({
        id: idOf(a),
        title: 'title' in a ? orNull(a.title) : null,
        category: 'category' in a ? orNull(a.category) : null,
        mimeType: 'mimeType' in a ? orNull(a.mimeType) : null,
        sizeBytes: 'sizeBytes' in a ? orNull(a.sizeBytes) : null,
      })),
    messages: visibleMessages(r, role).map((m) => ({
      id: m._id.toString(),
      from: { id: idOf(m.from), name: nameOf(m.from), role: m.role },
      text: m.text,
      visibility: m.visibility,
      at: m.at,
    })),
    closedReason: orNull(r.closedReason),
    statusHistory: (r.statusHistory ?? []).map((h) => ({
      status: h.status,
      at: h.at,
      ...(staff ? { by: idOf(h.by), note: orNull(h.note) } : {}),
    })),
  };
}
