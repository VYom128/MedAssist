import type { ClientSession, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  ROLES,
  tokenCounterKey,
  type AppointmentStatus,
} from '../../config/constants.js';
import { nextSequence } from '../../services/counter.service.js';
import {
  addDaysToDate,
  clinicToday,
  formatClinicDateTime,
  startOfClinicDay,
  toClinicDate,
} from '../../utils/dates.js';
import { withTransaction } from '../../utils/transaction.js';
import { assertPatientFree, bookingTransaction, lock, slotTaken } from './booking.service.js';
import { bookedBetween } from './slots.service.js';
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
  announceAppointment,
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
  { session }: { session?: ClientSession } = {},
): Promise<AppointmentLike> {
  assertTransition('appointment', appt.status, to);
  const at = new Date();
  const updated = await Appointment.findOneAndUpdate(
    { _id: appt._id, status: appt.status },
    {
      $set: { ...set, status: to, isSlotActive: slotActiveFor(to, appt.isOverbook ?? false) },
      $push: { statusHistory: { status: to, at, by, note: note ?? undefined } },
    },
    { new: true, runValidators: true, session },
  )
    .populate([...POPULATE])
    .lean();
  if (!updated) {
    const fresh = await Appointment.findById(appt._id)
      .select('status')
      .session(session ?? null)
      .lean();
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
  void announceAppointment(cancelled);
  void notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_CANCELLED, cancelled, {
    notifyDoctorSameDay: user.role !== ROLES.DOCTOR,
  });
  return viewForRole(user.role, cancelled);
}

/** The appointment's clinic date and today's, in the clinic timezone. */
async function clinicDays(appt: { startAt: Date }) {
  const { timezone } = await getSettings();
  return { timezone, date: toClinicDate(appt.startAt, timezone), today: clinicToday(timezone) };
}

const doctorIdOf = (appt: AppointmentLike) => appt.doctor._id.toString();

/**
 * POST /appointments/:id/check-in (reception) – scheduled → checked_in, only on the appointment's
 * clinic day. The token is the next number of the counter `token:<doctorId>:<date>` (spec §8.4),
 * taken in the same transaction, so parallel check-ins get distinct tokens and an aborted one
 * uses none.
 */
export async function checkIn(user: AuthUser, id: string, meta: RequestMeta) {
  const appt = await loadAppointment(id);
  await assertCanViewAppointment(user, appt, meta);
  assertTransition('appointment', appt.status, 'checked_in');
  const { date, today } = await clinicDays(appt);
  if (date !== today) {
    throw ApiError.unprocessable(`Patients can only be checked in on the day (${date})`);
  }
  const now = new Date();
  const checkedIn = await withTransaction(async (session) => {
    const token = await nextSequence(tokenCounterKey(doctorIdOf(appt), today), { session });
    return applyTransition(
      appt,
      'checked_in',
      { 'queue.tokenNumber': token, 'queue.checkedInAt': now, updatedBy: user.id },
      user.id,
      null,
      { session },
    );
  });
  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_CHECK_IN,
    actor: actorOf(user),
    resource: resourceOf(checkedIn),
    patient: checkedIn.patient._id,
    request: meta,
    metadata: { queueNumber: checkedIn.queue?.tokenNumber },
  });
  void announceAppointment(checkedIn);
  return viewForRole(user.role, checkedIn);
}

/**
 * Moves one of the doctor's checked-in appointments into consultation, in a transaction that
 * locks the doctor (bookingVersion), so a doctor is never in two consultations and two
 * "call next" clicks cannot pick two patients. 409 CONFLICT when the doctor already has a
 * patient in consultation today. `pick` chooses the appointment (null = nobody waiting).
 * TODO(Phase 5): create the encounter draft in this transaction and return its id.
 */
export async function beginConsultation(
  doctorId: string,
  by: string,
  pick: (
    session: ClientSession,
  ) => Promise<{ _id: Types.ObjectId; status: string; isOverbook?: boolean | null } | null>,
): Promise<AppointmentLike | null> {
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  return withTransaction(async (session) => {
    await lock(session, doctorId);
    // Today only: a consultation left open on an earlier day must not block the doctor forever.
    const busy = await Appointment.findOne({
      doctor: doctorId,
      status: 'in_consultation',
      startAt: {
        $gte: startOfClinicDay(today, timezone),
        $lt: startOfClinicDay(addDaysToDate(today, 1), timezone),
      },
    })
      .select('queue.tokenNumber')
      .session(session)
      .lean();
    if (busy) {
      const token = busy.queue?.tokenNumber;
      throw ApiError.conflict(
        `You already have a patient in consultation${token ? ` (token ${token})` : ''}. ` +
          'Complete that consultation first.',
        { appointmentId: busy._id.toString() },
      );
    }
    const appt = await pick(session);
    if (!appt) return null;
    const now = new Date();
    return applyTransition(
      appt,
      'in_consultation',
      { 'queue.calledAt': now, 'queue.startedAt': now, updatedBy: by },
      by,
      null,
      { session },
    );
  });
}

/** Audit + real-time events after a consultation started (start or call-next). */
export async function afterConsultationStarted(
  user: AuthUser,
  appt: AppointmentLike,
  meta: RequestMeta,
  via: 'start' | 'call_next',
) {
  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_START,
    actor: actorOf(user),
    resource: resourceOf(appt),
    patient: appt.patient._id,
    request: meta,
    metadata: { via, queueNumber: appt.queue?.tokenNumber },
  });
  void announceAppointment(appt);
}

/** POST /appointments/:id/start (doctor, own) – checked_in → in_consultation. */
export async function startConsultation(user: AuthUser, id: string, meta: RequestMeta) {
  const appt = await loadAppointment(id);
  await assertCanViewAppointment(user, appt, meta);
  assertTransition('appointment', appt.status, 'in_consultation');
  const started = (await beginConsultation(user.id, user.id, async () => appt))!;
  await afterConsultationStarted(user, started, meta, 'start');
  return viewForRole(user.role, started);
}

/** POST /appointments/:id/complete (doctor, own) – in_consultation → completed. */
export async function completeConsultation(user: AuthUser, id: string, meta: RequestMeta) {
  const appt = await loadAppointment(id);
  await assertCanViewAppointment(user, appt, meta);
  const completed = await applyTransition(
    appt,
    'completed',
    { 'queue.completedAt': new Date(), updatedBy: user.id },
    user.id,
  );
  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_COMPLETE,
    actor: actorOf(user),
    resource: resourceOf(completed),
    patient: completed.patient._id,
    request: meta,
  });
  void announceAppointment(completed);
  return viewForRole(user.role, completed);
}

/**
 * POST /appointments/:id/no-show (reception) – scheduled → no_show once the appointment has
 * started (earlier makes no sense; the job marks the rest). Frees the slot; patient notified.
 */
export async function markNoShow(user: AuthUser, id: string, meta: RequestMeta) {
  const appt = await loadAppointment(id);
  await assertCanViewAppointment(user, appt, meta);
  assertTransition('appointment', appt.status, 'no_show');
  if (appt.startAt > new Date()) {
    const { timezone } = await getSettings();
    throw ApiError.unprocessable(
      `This appointment starts at ${formatClinicDateTime(appt.startAt, timezone)}; ` +
        'it can be marked as a no-show after that',
    );
  }
  const missed = await applyTransition(appt, 'no_show', { updatedBy: user.id }, user.id);
  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
    actor: actorOf(user),
    resource: resourceOf(missed),
    patient: missed.patient._id,
    request: meta,
    metadata: { via: 'manual' },
  });
  void announceAppointment(missed);
  void notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW, missed);
  return viewForRole(user.role, missed);
}

/**
 * POST /appointments/:id/undo-no-show (reception) – no_show → scheduled on the appointment's
 * clinic day only, and only if its slot is still free (409 SLOT_UNAVAILABLE) and the patient has
 * not booked something clashing meanwhile (409 PATIENT_DOUBLE_BOOKED). Locks like a booking.
 * Sets `noShowUndoneAt` so the no-show job does not mark it again.
 */
export async function undoNoShow(user: AuthUser, id: string, meta: RequestMeta) {
  const appt = await loadAppointment(id);
  await assertCanViewAppointment(user, appt, meta);
  // The table also allows scheduled → scheduled (a reschedule), so check the source status too.
  if (appt.status !== 'no_show') throw invalidTransition('appointment', appt.status, 'scheduled');
  const { date, today, timezone } = await clinicDays(appt);
  if (date !== today) {
    throw ApiError.unprocessable('A no-show can only be undone on the day of the appointment');
  }
  const restored = await bookingTransaction(async (session) => {
    await lock(session, appt.doctor._id, appt.patient._id);
    if (!appt.isOverbook) {
      const taken = await bookedBetween(appt.doctor._id, appt.startAt, appt.endAt, {
        session,
        excludeId: appt._id,
      });
      if (taken.length > 0) throw slotTaken();
    }
    await assertPatientFree(
      {
        you: false,
        patientId: appt.patient._id,
        doctorId: appt.doctor._id,
        range: appt,
        date,
        timezone,
        excludeId: appt._id,
      },
      session,
    );
    return applyTransition(
      appt,
      'scheduled',
      { noShowUndoneAt: new Date(), updatedBy: user.id },
      user.id,
      'No-show undone',
      { session },
    );
  });
  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_UNDO_NO_SHOW,
    actor: actorOf(user),
    resource: resourceOf(restored),
    patient: restored.patient._id,
    request: meta,
  });
  void announceAppointment(restored);
  return viewForRole(user.role, restored);
}
