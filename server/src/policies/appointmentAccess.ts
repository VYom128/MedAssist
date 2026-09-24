import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ROLES } from '../config/constants.js';
import * as audit from '../services/audit.service.js';
import type { AuthUser } from '../types/express.js';
import { ApiError } from '../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../utils/requestContext.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId } | string;

/** The appointment fields the rules look at (`patient`/`doctor` may be populated). */
export interface AppointmentRefs {
  _id: Types.ObjectId;
  patient: Ref;
  doctor: Ref;
}

const idOf = (ref: Ref) => (typeof ref === 'object' && '_id' in ref ? ref._id : ref).toString();

/**
 * Who sees which appointments (spec §2.4): admins and receptionists all; a doctor their own; a
 * patient their own (linked record only). Lab technicians none.
 */
export function canViewAppointment(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
  appt: AppointmentRefs,
): boolean {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return true;
    case ROLES.DOCTOR:
      return idOf(appt.doctor) === user.id;
    case ROLES.PATIENT:
      return user.patientId !== null && idOf(appt.patient) === user.patientId;
    default:
      return false;
  }
}

/** Mongo filter for the appointments `user` may list (GET /appointments, calendar). */
export function appointmentListFilter(
  user: Pick<AuthUser, 'id' | 'role' | 'patientId'>,
): Record<string, unknown> {
  switch (user.role) {
    case ROLES.ADMIN:
    case ROLES.RECEPTIONIST:
      return {};
    case ROLES.DOCTOR:
      return { doctor: user.id };
    case ROLES.PATIENT:
      return user.patientId ? { patient: user.patientId } : { _id: { $in: [] } };
    default:
      return { _id: { $in: [] } };
  }
}

/**
 * 404 NOT_FOUND (never 403, spec §10.2) unless `user` may see the appointment; the denial is
 * audited as `access.denied` with the patient.
 */
export async function assertCanViewAppointment(
  user: AuthUser,
  appt: AppointmentRefs,
  request?: RequestMeta,
): Promise<void> {
  if (canViewAppointment(user, appt)) return;
  await audit.record({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    outcome: 'denied',
    actor: actorOf(user),
    resource: { type: 'appointment', id: appt._id },
    patient: idOf(appt.patient),
    request,
    metadata: { reason: 'appointment_access' },
  });
  throw ApiError.notFound('Appointment not found');
}
