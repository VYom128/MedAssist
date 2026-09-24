import type { Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants.js';
import { ageOf } from '../patients/serializer.js';
import type { AppointmentDoc } from './model.js';

/**
 * Appointment views per role (spec §2.4, §2.5):
 * - admin / receptionist: everything, with the patient's name, MRN, age, sex and phone;
 * - doctor (own appointments): the minimal patient view – name, MRN, age, sex – plus the
 *   stated reason; full clinical access comes with the care relationship (Phase 5);
 * - patient (own): no patient block, no staff notes (who changed what, staff reasons, priority).
 */

export interface PatientRef {
  _id: Types.ObjectId;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
  phone?: string;
  /** Linked portal account (for real-time events; never serialised). */
  user?: Types.ObjectId | null;
}
interface UserRef {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
}
interface DepartmentRef {
  _id: Types.ObjectId;
  name: string;
}

/** An appointment with `patient`, `doctor` and `department` populated. */
export type AppointmentLike = Omit<AppointmentDoc, 'patient' | 'doctor' | 'department'> & {
  _id: Types.ObjectId;
  patient: PatientRef;
  doctor: UserRef;
  department?: DepartmentRef | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/** What `populate()` loads for the views. */
export const POPULATE = [
  { path: 'patient', select: 'mrn firstName lastName dateOfBirth gender phone user' },
  { path: 'doctor', select: 'firstName lastName' },
  { path: 'department', select: 'name' },
] as const;

const idOf = (id?: Types.ObjectId | null) => id?.toString() ?? null;

function base(a: AppointmentLike) {
  return {
    id: a._id.toString(),
    appointmentNumber: a.appointmentNumber,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    type: a.type,
    source: a.source,
    reason: a.reason ?? null,
    doctor: { id: a.doctor._id.toString(), name: `${a.doctor.firstName} ${a.doctor.lastName}` },
    department: a.department ? { id: a.department._id.toString(), name: a.department.name } : null,
    service: {
      id: idOf(a.service),
      name: a.serviceSnapshot.name,
      durationMinutes: a.serviceSnapshot.durationMinutes,
      pricePaise: a.serviceSnapshot.pricePaise,
    },
    followUpOf: idOf(a.followUpOf),
    tokenNumber: a.queue?.tokenNumber ?? null,
    checkedInAt: a.queue?.checkedInAt ?? null,
    createdAt: a.createdAt ?? null,
    updatedAt: a.updatedAt ?? null,
  };
}

/** Name, MRN, age, sex: what a doctor sees about the patient on their own appointments. */
function minimalPatient(p: PatientRef) {
  return {
    id: p._id.toString(),
    mrn: p.mrn,
    fullName: `${p.firstName} ${p.lastName}`,
    age: ageOf(p),
    gender: p.gender,
  };
}

const history = (a: AppointmentLike) => ({
  priority: a.priority,
  isOverbook: a.isOverbook,
  queue: {
    tokenNumber: a.queue?.tokenNumber ?? null,
    checkedInAt: a.queue?.checkedInAt ?? null,
    calledAt: a.queue?.calledAt ?? null,
    startedAt: a.queue?.startedAt ?? null,
    completedAt: a.queue?.completedAt ?? null,
  },
  cancellation: a.cancellation?.at
    ? {
        at: a.cancellation.at,
        by: idOf(a.cancellation.by),
        byRole: a.cancellation.byRole ?? null,
        reason: a.cancellation.reason ?? null,
      }
    : null,
  rescheduleHistory: (a.rescheduleHistory ?? []).map((r) => ({
    fromStartAt: r.fromStartAt,
    toStartAt: r.toStartAt,
    fromDoctor: idOf(r.fromDoctor),
    toDoctor: idOf(r.toDoctor),
    by: idOf(r.by),
    byRole: r.byRole ?? null,
    at: r.at,
    reason: r.reason ?? null,
  })),
  priorityHistory: (a.priorityHistory ?? []).map((p) => ({
    from: p.from,
    to: p.to,
    by: idOf(p.by),
    at: p.at,
    reason: p.reason ?? null,
  })),
  statusHistory: (a.statusHistory ?? []).map((h) => ({
    status: h.status,
    at: h.at,
    by: idOf(h.by),
    note: h.note ?? null,
  })),
});

/** Admin and receptionist. */
export function toStaffView(a: AppointmentLike) {
  return {
    ...base(a),
    patient: { ...minimalPatient(a.patient), phone: a.patient.phone ?? null },
    ...history(a),
    bookedBy: idOf(a.bookedBy),
    reminderSentAt: a.reminderSentAt ?? null,
  };
}

/** The appointment's doctor. */
export function toDoctorView(a: AppointmentLike) {
  return { ...base(a), patient: minimalPatient(a.patient), ...history(a) };
}

/** The patient: their own appointment without staff notes. */
export function toPatientView(a: AppointmentLike) {
  const byPatient = a.cancellation?.byRole === ROLES.PATIENT;
  return {
    ...base(a),
    cancellation: a.cancellation?.at
      ? {
          at: a.cancellation.at,
          byYou: byPatient,
          reason: byPatient ? (a.cancellation.reason ?? null) : null,
        }
      : null,
    rescheduleHistory: (a.rescheduleHistory ?? []).map((r) => ({
      fromStartAt: r.fromStartAt,
      toStartAt: r.toStartAt,
      at: r.at,
    })),
  };
}

export function viewForRole(role: Role, a: AppointmentLike) {
  switch (role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return toStaffView(a);
    case ROLES.DOCTOR:
      return toDoctorView(a);
    case ROLES.PATIENT:
      return toPatientView(a);
    default:
      throw new Error(`No appointment view for role ${role}`);
  }
}

/** Compact calendar event (GET /appointments/calendar): patient as "Priya S.". */
export function toCalendarEvent(a: AppointmentLike) {
  return {
    id: a._id.toString(),
    appointmentNumber: a.appointmentNumber,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    type: a.type,
    priority: a.priority,
    isOverbook: a.isOverbook,
    doctorId: a.doctor._id.toString(),
    patientShortName: `${a.patient.firstName} ${a.patient.lastName.charAt(0)}.`,
  };
}
