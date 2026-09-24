import type { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  ROLES,
  type AppointmentStatus,
} from '../../config/constants.js';
import { assertCanViewAppointment } from '../../policies/appointmentAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { getSettings } from '../settings/service.js';
import { Appointment, slotActiveFor } from './model.js';
import { POPULATE, viewForRole, type AppointmentLike } from './serializer.js';
import {
  assertPatientMayChange,
  loadAppointment,
  notifyAppointment,
  requireStaffReason,
  resourceOf,
} from './service.js';
import type { CancelInput } from './validation.js';

/**
 * Status actions (spec §5.1, §7.8). Each checks the transition table, then moves the status with
 * one conditional update (`{ _id, status: from }`), so two concurrent actions cannot both apply:
 * the loser gets 409 INVALID_STATUS_TRANSITION. `isSlotActive` is set with the status.
 */

/**
 * Moves `appt` from its current status to `to`, setting `set` and appending to statusHistory.
 * @param by the acting user id, or null for system jobs.
 */
export async function applyTransition(
  appt: { _id: Types.ObjectId; status: string; isOverbook?: boolean | null },
  to: AppointmentStatus,
  set: Record<string, unknown>,
  by: string | null,
  note?: string | null,
): Promise<AppointmentLike> {
  assertTransition('appointment', appt.status, to);
  const at = new Date();
  const updated = await Appointment.findOneAndUpdate(
    { _id: appt._id, status: appt.status },
    {
      $set: { ...set, status: to, isSlotActive: slotActiveFor(to, appt.isOverbook ?? false) },
      $push: { statusHistory: { status: to, at, by, note: note ?? undefined } },
    },
    { new: true, runValidators: true },
  )
    .populate([...POPULATE])
    .lean();
  if (!updated) {
    const fresh = await Appointment.findById(appt._id).select('status').lean();
    throw invalidTransition('appointment', fresh?.status ?? appt.status, to);
  }
  return updated as unknown as AppointmentLike;
}

/**
 * POST /appointments/:id/cancel (spec §8.3) – from scheduled or checked in. Staff and the
 * appointment's doctor give a reason; the patient may cancel their own scheduled appointment
 * until `minCancelHours` before the start. Frees the slot (isSlotActive false), audited
 * `appointment.cancel`, patient notified.
 */
export async function cancelAppointment(
  user: AuthUser,
  id: string,
  input: CancelInput,
  meta: RequestMeta,
) {
  const appt = await loadAppointment(id);
  await assertCanViewAppointment(user, appt, meta);
  assertTransition('appointment', appt.status, 'cancelled');
  const now = new Date();
  if (user.role === ROLES.PATIENT) {
    if (appt.status !== 'scheduled') {
      throw new ApiError(
        422,
        'You have already checked in. Please speak to reception.',
        ERROR_CODES.CANCELLATION_WINDOW_PASSED,
      );
    }
    assertPatientMayChange(appt.startAt, await getSettings(), now);
  } else {
    requireStaffReason(input.reason);
  }

  const cancelled = await applyTransition(
    appt,
    'cancelled',
    {
      cancellation: { by: user.id, byRole: user.role, at: now, reason: input.reason ?? undefined },
      updatedBy: user.id,
    },
    user.id,
    input.reason,
  );
  // TODO(Phase 7): void the appointment's draft invoice (spec §8.3).

  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_CANCEL,
    actor: actorOf(user),
    resource: resourceOf(cancelled),
    patient: cancelled.patient._id,
    request: meta,
    metadata: {
      fromStatus: appt.status,
      startAt: appt.startAt,
      reasonGiven: Boolean(input.reason),
    },
  });
  void notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_CANCELLED, cancelled, {
    notifyDoctorSameDay: user.role !== ROLES.DOCTOR,
  });
  return viewForRole(user.role, cancelled);
}
