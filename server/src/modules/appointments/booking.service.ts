import type { ClientSession, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  OPEN_APPOINTMENT_STATUSES,
  ROLES,
  SEQUENCES,
  tokenCounterKey,
} from '../../config/constants.js';
import { assertCanAccessPatient } from '../../policies/patientAccess.js';
import { assertCanViewAppointment } from '../../policies/appointmentAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  addDaysToDate,
  clinicToday,
  startOfClinicDay,
  toClinicDate,
  zonedDateTimeToUtc,
} from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { invalidTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { DoctorProfile } from '../doctors/model.js';
import { findDoctor } from '../doctors/service.js';
import { Patient } from '../patients/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { loadPatient } from '../patients/service.js';
import { getScheduleForDate } from '../schedules/service.js';
import { getSettings } from '../settings/service.js';
import { Appointment } from './model.js';
import {
  announceAppointment,
  assertPatientMayChange,
  loadAppointment,
  notifyAppointment,
  requireStaffReason,
  resourceOf,
} from './service.js';
import { viewForRole } from './serializer.js';
import { generateSlots, type Slot, type TimeRange } from './slots.js';
import {
  assertInBookingWindow,
  bookedBetween,
  isBookable,
  leavesBetween,
  loadService,
  slotMinutesOf,
  workingSchedule,
  type BookableDoctor,
  type ServiceLike,
} from './slots.service.js';
import type { BookAppointmentInput, RescheduleInput, WalkInInput } from './validation.js';

/**
 * Booking and rescheduling (spec §4.5, §8.2). Each runs in one transaction that first "locks"
 * the doctor and the patient by incrementing `bookingVersion` on their DoctorProfile and Patient
 * documents. Two overlapping transactions then write the same document: MongoDB aborts one with
 * a write conflict, the driver retries it (utils/transaction.ts), and the retry sees the first
 * booking and fails its checks. The partial unique index `{ doctor, startAt }` (isSlotActive)
 * is the last safety net.
 */

type Settings = Awaited<ReturnType<typeof getSettings>>;

export const slotTaken = () =>
  new ApiError(
    409,
    'This slot was just taken. Please pick another time.',
    ERROR_CODES.SLOT_UNAVAILABLE,
  );
const notOffered = () =>
  new ApiError(
    409,
    'That time is not available for this doctor. Please pick another slot.',
    ERROR_CODES.SLOT_UNAVAILABLE,
  );
export const doctorUnavailable = (message: string) =>
  new ApiError(409, message, ERROR_CODES.DOCTOR_UNAVAILABLE);
const doubleBooked = (message: string, appointmentId: Types.ObjectId) =>
  new ApiError(409, message, ERROR_CODES.PATIENT_DOUBLE_BOOKED, {
    appointmentId: appointmentId.toString(),
  });

const isPatient = (user: Pick<AuthUser, 'role'>) => user.role === ROLES.PATIENT;

/** Duplicate key on the `{ doctor, startAt }` slot index. */
const isSlotIndexClash = (err: unknown) =>
  (err as { code?: number }).code === 11000 &&
  'startAt' in ((err as { keyPattern?: object }).keyPattern ?? {});

/** A write conflict that outlived the driver's retries. */
const isWriteConflict = (err: unknown) => {
  const e = err as { code?: number; hasErrorLabel?: (label: string) => boolean };
  return e.code === 112 || e.hasErrorLabel?.('TransientTransactionError') === true;
};

/** Runs a booking transaction; a lost race on the slot → 409 SLOT_UNAVAILABLE. */
export async function bookingTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(work);
  } catch (err) {
    if (isSlotIndexClash(err) || isWriteConflict(err)) throw slotTaken();
    throw err;
  }
}

/**
 * The booking lock: bumps `bookingVersion` on the doctor's profile and (when given) the patient.
 */
export async function lock(
  session: ClientSession,
  doctorId: Types.ObjectId | string,
  patientId?: Types.ObjectId | string,
) {
  await DoctorProfile.updateOne({ user: doctorId }, { $inc: { bookingVersion: 1 } }, { session });
  if (patientId) {
    await Patient.updateOne({ _id: patientId }, { $inc: { bookingVersion: 1 } }, { session });
  }
}

/**
 * The patient side of §8.2, inside the locked transaction: no open appointment overlapping
 * `range` (any doctor), and no other open appointment with the same doctor that clinic day
 * → 409 PATIENT_DOUBLE_BOOKED.
 */
export async function assertPatientFree(
  c: {
    /** The caller is the patient (messages say "you"). */
    you: boolean;
    patientId: Types.ObjectId;
    doctorId: Types.ObjectId;
    range: TimeRange;
    /** Clinic date of the appointment. */
    date: string;
    timezone: string;
    excludeId?: Types.ObjectId;
  },
  session: ClientSession,
) {
  const others = c.excludeId ? { _id: { $ne: c.excludeId } } : {};
  const open = { patient: c.patientId, status: { $in: OPEN_APPOINTMENT_STATUSES }, ...others };
  const overlapping = await Appointment.findOne({
    ...open,
    startAt: { $lt: c.range.endAt },
    endAt: { $gt: c.range.startAt },
  })
    .select('_id')
    .session(session)
    .lean();
  if (overlapping) {
    throw doubleBooked(
      c.you
        ? 'You already have an appointment at that time'
        : 'The patient already has an appointment at that time',
      overlapping._id,
    );
  }
  const sameDay = await Appointment.findOne({
    ...open,
    doctor: c.doctorId,
    startAt: {
      $gte: startOfClinicDay(c.date, c.timezone),
      $lt: startOfClinicDay(addDaysToDate(c.date, 1), c.timezone),
    },
  })
    .select('_id')
    .session(session)
    .lean();
  if (sameDay) {
    throw doubleBooked(
      c.you
        ? 'You already have an appointment with this doctor that day'
        : 'The patient already has an appointment with this doctor that day',
      sameDay._id,
    );
  }
}

interface SlotCheck {
  user: AuthUser;
  doctor: BookableDoctor;
  patientId: Types.ObjectId;
  service: Pick<ServiceLike, 'durationMinutes'>;
  startAt: Date;
  settings: Settings;
  now: Date;
  /** The appointment being rescheduled (ignored in the clash checks). */
  excludeId?: Types.ObjectId;
  /** New bookings by patients count against maxActiveBookingsPerPatient. */
  enforceLimit: boolean;
}

/**
 * The §8.2 checks, run inside the locked transaction:
 * - the time is a slot of the doctor's schedule that day (grid, working day, lead time);
 * - not during the doctor's leave → DOCTOR_UNAVAILABLE;
 * - no active appointment of the doctor overlaps → SLOT_UNAVAILABLE;
 * - the patient has no open appointment overlapping (any doctor), nor another open one with the
 *   same doctor that clinic day → PATIENT_DOUBLE_BOOKED;
 * - patients: at most maxActiveBookingsPerPatient upcoming bookings → BOOKING_LIMIT_REACHED.
 */
async function assertSlotFree(c: SlotCheck, session: ClientSession): Promise<Slot> {
  const { timezone } = c.settings;
  const doctorId = c.doctor.user._id;
  const date = toClinicDate(c.startAt, timezone);
  const schedule = workingSchedule(c.settings, date, await getScheduleForDate(doctorId, date));
  const slot = generateSlots({
    date,
    schedule,
    slotMinutes: slotMinutesOf(c.doctor, c.settings),
    serviceMinutes: c.service.durationMinutes,
    now: c.now,
    timezone,
  }).find((s) => s.startAt.getTime() === c.startAt.getTime());
  if (!slot) throw notOffered();

  if ((await leavesBetween(doctorId, slot.startAt, slot.endAt, session)).length > 0) {
    throw doctorUnavailable('The doctor is on leave at that time');
  }
  const booked = await bookedBetween(doctorId, slot.startAt, slot.endAt, {
    session,
    excludeId: c.excludeId,
  });
  if (booked.length > 0) throw slotTaken();

  await assertPatientFree(
    {
      you: isPatient(c.user),
      patientId: c.patientId,
      doctorId,
      range: slot,
      date,
      timezone,
      excludeId: c.excludeId,
    },
    session,
  );

  if (c.enforceLimit) {
    const max = c.settings.appointment!.maxActiveBookingsPerPatient;
    const upcoming = await Appointment.countDocuments({
      patient: c.patientId,
      status: 'scheduled',
      startAt: { $gt: c.now },
    }).session(session);
    if (upcoming >= max) {
      throw new ApiError(
        422,
        `You can have at most ${max} upcoming appointments. Cancel one to book another.`,
        ERROR_CODES.BOOKING_LIMIT_REACHED,
        { max },
      );
    }
  }
  return slot;
}

/**
 * Whose appointment this is. Patients book for themselves: self-booking must be on (403
 * SELF_BOOKING_DISABLED) and their account linked (403 PATIENT_LINK_PENDING). Staff send
 * `patientId`, checked by the patient-access policy.
 */
async function bookingPatientId(
  user: AuthUser,
  patientId: string | undefined,
  settings: Settings,
  meta: RequestMeta,
): Promise<string> {
  if (isPatient(user)) {
    if (!settings.appointment!.allowPatientSelfBooking) {
      throw new ApiError(
        403,
        'Online booking is turned off. Please call the clinic to book.',
        ERROR_CODES.SELF_BOOKING_DISABLED,
      );
    }
    const own = await resolveMyPatientId(user);
    if (patientId && patientId !== own)
      await assertCanAccessPatient(user, patientId, 'demographics', meta);
    return own;
  }
  if (!patientId) {
    throw ApiError.validation('Validation failed', [
      { field: 'body.patientId', message: 'Required' },
    ]);
  }
  await assertCanAccessPatient(user, patientId, 'demographics', meta);
  return patientId;
}

/** `followUpOf` must be a completed appointment of the same patient. */
async function assertFollowUpOf(followUpOf: string, patientId: string) {
  const previous = await Appointment.findById(followUpOf).select('patient status').lean();
  if (!previous || previous.patient.toString() !== patientId || previous.status !== 'completed') {
    throw ApiError.unprocessable('A follow-up must refer to a completed visit of this patient', [
      { field: 'body.followUpOf', message: 'Not a completed appointment of this patient' },
    ]);
  }
}

/**
 * POST /appointments (spec §4.5, §8.2) – receptionist, admin, or the patient for themselves.
 * Audited `appointment.create`; after the commit the patient gets a confirmation email (and the
 * doctor an email for same-day bookings).
 */
export async function bookAppointment(
  user: AuthUser,
  input: BookAppointmentInput,
  meta: RequestMeta,
) {
  const settings = await getSettings();
  const { timezone } = settings;
  const patientId = await bookingPatientId(user, input.patientId, settings, meta);
  const patient = await loadPatient(patientId);
  if (!patient.isActive) throw ApiError.unprocessable('This patient record is inactive');
  const doctor = await findDoctor(input.doctorId);
  if (!isBookable(doctor)) throw doctorUnavailable('This doctor is not taking appointments');
  const service = await loadService(input.serviceId, doctor);
  const now = new Date();
  const today = clinicToday(timezone, now);
  assertInBookingWindow(user, toClinicDate(input.startAt, timezone), today, settings);
  if (input.followUpOf) await assertFollowUpOf(input.followUpOf, patientId);

  const created = await bookingTransaction(async (session) => {
    await lock(session, doctor.user._id, patient._id);
    const slot = await assertSlotFree(
      {
        user,
        doctor,
        patientId: patient._id,
        service,
        startAt: input.startAt,
        settings,
        now,
        enforceLimit: isPatient(user),
      },
      session,
    );
    const year = Number(today.slice(0, 4));
    const seq = await nextSequence(`${SEQUENCES.APPOINTMENT.key}:${year}`, { session });
    const [doc] = await Appointment.create(
      [
        {
          appointmentNumber: formatNumber(SEQUENCES.APPOINTMENT.prefix, seq, { year }),
          patient: patient._id,
          doctor: doctor.user._id,
          department: doctor.department?._id,
          service: service._id,
          serviceSnapshot: {
            name: service.name,
            durationMinutes: service.durationMinutes,
            pricePaise: service.pricePaise,
          },
          startAt: slot.startAt,
          endAt: slot.endAt,
          type: input.type,
          source: isPatient(user) ? 'patient_portal' : 'reception',
          reason: input.reason ?? undefined,
          status: 'scheduled',
          followUpOf: input.followUpOf,
          statusHistory: [{ status: 'scheduled', at: now, by: user.id }],
          bookedBy: user.id,
        },
      ],
      { session },
    );
    return doc!;
  });

  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: patient._id,
    request: meta,
    metadata: {
      doctor: doctor.user._id.toString(),
      service: service._id.toString(),
      startAt: created.startAt,
      type: created.type,
      source: created.source,
    },
  });
  const view = await loadAppointment(created._id);
  void announceAppointment(view);
  void notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_BOOKED, view, {
    notifyDoctorSameDay: true,
  });
  return viewForRole(user.role, view);
}

/**
 * POST /appointments/:id/reschedule (spec §4.5) – staff (reason required), or the patient for
 * their own appointment up to `minCancelHours` before its current start. Only from `scheduled`.
 * The same checks and locks as booking, in one transaction that moves the same appointment, so
 * the old slot is released only if the new one is taken.
 */
export async function rescheduleAppointment(
  user: AuthUser,
  id: string,
  input: RescheduleInput,
  meta: RequestMeta,
) {
  const settings = await getSettings();
  const { timezone } = settings;
  const now = new Date();
  const current = await Appointment.findById(id).lean();
  if (!current) throw ApiError.notFound('Appointment not found');
  await assertCanViewAppointment(user, current, meta);
  if (current.status !== 'scheduled')
    throw invalidTransition('appointment', current.status, 'scheduled');
  if (isPatient(user)) {
    if (!settings.appointment!.allowPatientSelfBooking) {
      throw new ApiError(
        403,
        'Online booking is turned off. Please call the clinic to change your appointment.',
        ERROR_CODES.SELF_BOOKING_DISABLED,
      );
    }
    assertPatientMayChange(current.startAt, settings, now);
  } else {
    requireStaffReason(input.reason);
  }

  const doctor = await findDoctor(input.doctorId ?? current.doctor);
  if (!isBookable(doctor)) throw doctorUnavailable('This doctor is not taking appointments');
  const changesService = Boolean(input.serviceId || input.doctorId);
  const service: Pick<ServiceLike, 'durationMinutes' | 'name' | 'pricePaise'> & {
    _id?: Types.ObjectId | null;
  } = changesService
    ? await loadService(input.serviceId ?? current.service!, doctor)
    : { _id: current.service, ...current.serviceSnapshot };
  const sameDoctor = doctor.user._id.equals(current.doctor);
  if (
    sameDoctor &&
    input.startAt.getTime() === current.startAt.getTime() &&
    service.durationMinutes === current.serviceSnapshot.durationMinutes
  ) {
    throw ApiError.unprocessable('Pick a different time', [
      { field: 'body.startAt', message: 'Same as the current time' },
    ]);
  }
  assertInBookingWindow(
    user,
    toClinicDate(input.startAt, timezone),
    clinicToday(timezone, now),
    settings,
  );

  const moved = await bookingTransaction(async (session) => {
    await lock(session, doctor.user._id, current.patient);
    const appt = await Appointment.findById(id).session(session);
    if (!appt || appt.status !== 'scheduled') {
      throw invalidTransition('appointment', appt?.status ?? current.status, 'scheduled');
    }
    const slot = await assertSlotFree(
      {
        user,
        doctor,
        patientId: appt.patient,
        service,
        startAt: input.startAt,
        settings,
        now,
        excludeId: appt._id,
        enforceLimit: false,
      },
      session,
    );
    appt.rescheduleHistory.push({
      fromStartAt: appt.startAt,
      toStartAt: slot.startAt,
      fromDoctor: appt.doctor,
      toDoctor: doctor.user._id,
      by: user.id,
      byRole: user.role,
      at: now,
      reason: input.reason ?? undefined,
    });
    appt.set({
      doctor: doctor.user._id,
      department: doctor.department?._id,
      service: service._id ?? undefined,
      serviceSnapshot: {
        name: service.name,
        durationMinutes: service.durationMinutes,
        pricePaise: service.pricePaise,
      },
      startAt: slot.startAt,
      endAt: slot.endAt,
      reminderSentAt: undefined, // remind again before the new time
      updatedBy: user.id,
    });
    await appt.save({ session });
    return appt;
  });

  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_RESCHEDULE,
    actor: actorOf(user),
    resource: resourceOf(moved),
    patient: moved.patient,
    request: meta,
    metadata: {
      fromStartAt: current.startAt,
      toStartAt: moved.startAt,
      fromDoctor: current.doctor.toString(),
      toDoctor: moved.doctor.toString(),
      reasonGiven: Boolean(input.reason),
    },
  });
  const view = await loadAppointment(moved._id);
  void announceAppointment(view, { doctor: current.doctor, startAt: current.startAt });
  void notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED, view, {
    notifyDoctorSameDay: true,
  });
  return viewForRole(user.role, view);
}

/**
 * POST /appointments/walk-in (spec §4.5) – reception registers a patient who has just arrived:
 * the next free slot in the doctor's session running now; if the session is full, an overbook
 * starting now (isSlotActive false, isOverbook true), at most
 * `settings.appointment.walkInOverbookPerSession` per session → 422 OVERBOOK_LIMIT_REACHED.
 * Created directly as checked in with the next token. No session running now, leave, or a
 * doctor not taking appointments → 409 DOCTOR_UNAVAILABLE.
 */
export async function walkIn(user: AuthUser, input: WalkInInput, meta: RequestMeta) {
  const settings = await getSettings();
  const { timezone } = settings;
  await assertCanAccessPatient(user, input.patientId, 'demographics', meta);
  const patient = await loadPatient(input.patientId);
  if (!patient.isActive) throw ApiError.unprocessable('This patient record is inactive');
  const doctor = await findDoctor(input.doctorId);
  if (!isBookable(doctor)) throw doctorUnavailable('This doctor is not taking appointments');
  const service = await loadService(input.serviceId, doctor);
  const doctorId = doctor.user._id;

  const now = new Date();
  const today = clinicToday(timezone, now);
  const schedule = workingSchedule(settings, today, await getScheduleForDate(doctorId, today));
  const running = schedule?.sessions.find(
    (s) =>
      zonedDateTimeToUtc(today, s.start, timezone) <= now &&
      now < zonedDateTimeToUtc(today, s.end, timezone),
  );
  if (!running) throw doctorUnavailable('The doctor has no session running now');
  const sessionRange = {
    startAt: zonedDateTimeToUtc(today, running.start, timezone),
    endAt: zonedDateTimeToUtc(today, running.end, timezone),
  };
  const durationMs = service.durationMinutes * 60_000;

  const created = await bookingTransaction(async (session) => {
    await lock(session, doctorId, patient._id);
    const [leaves, booked] = await Promise.all([
      leavesBetween(doctorId, sessionRange.startAt, sessionRange.endAt, session),
      bookedBetween(doctorId, sessionRange.startAt, sessionRange.endAt, { session }),
    ]);
    const [free] = generateSlots({
      date: today,
      schedule: { sessions: [running] },
      slotMinutes: slotMinutesOf(doctor, settings),
      serviceMinutes: service.durationMinutes,
      leaves,
      booked,
      now,
      timezone,
      minLeadMinutes: 0, // the patient is here: any slot from now on
    });
    let range: TimeRange;
    if (free) {
      range = free;
    } else {
      range = { startAt: now, endAt: new Date(now.getTime() + durationMs) };
      if (leaves.some((l) => l.startAt < range.endAt && l.endAt > range.startAt)) {
        throw doctorUnavailable('The doctor is on leave now');
      }
      const limit = settings.appointment!.walkInOverbookPerSession;
      const overbooked = await Appointment.countDocuments({
        doctor: doctorId,
        isOverbook: true,
        status: { $ne: 'cancelled' },
        startAt: { $gte: sessionRange.startAt, $lt: sessionRange.endAt },
      }).session(session);
      if (overbooked >= limit) {
        throw new ApiError(
          422,
          `This session is full and its ${limit} walk-in overbook places are taken`,
          ERROR_CODES.OVERBOOK_LIMIT_REACHED,
          { limit },
        );
      }
    }
    await assertPatientFree(
      { you: false, patientId: patient._id, doctorId, range, date: today, timezone },
      session,
    );
    const year = Number(today.slice(0, 4));
    const seq = await nextSequence(`${SEQUENCES.APPOINTMENT.key}:${year}`, { session });
    const token = await nextSequence(tokenCounterKey(doctorId.toString(), today), { session });
    const [doc] = await Appointment.create(
      [
        {
          appointmentNumber: formatNumber(SEQUENCES.APPOINTMENT.prefix, seq, { year }),
          patient: patient._id,
          doctor: doctorId,
          department: doctor.department?._id,
          service: service._id,
          serviceSnapshot: {
            name: service.name,
            durationMinutes: service.durationMinutes,
            pricePaise: service.pricePaise,
          },
          startAt: range.startAt,
          endAt: range.endAt,
          type: 'walk_in',
          source: 'walk_in',
          reason: input.reason ?? undefined,
          status: 'checked_in',
          priority: input.priority,
          isOverbook: !free,
          queue: { tokenNumber: token, checkedInAt: now },
          statusHistory: [{ status: 'checked_in', at: now, by: user.id, note: 'Walk-in' }],
          bookedBy: user.id,
        },
      ],
      { session },
    );
    return doc!;
  });

  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: patient._id,
    request: meta,
    metadata: {
      doctor: doctorId.toString(),
      service: service._id.toString(),
      startAt: created.startAt,
      type: 'walk_in',
      source: 'walk_in',
      isOverbook: created.isOverbook,
      queueNumber: created.queue?.tokenNumber,
    },
  });
  const view = await loadAppointment(created._id);
  void announceAppointment(view);
  return viewForRole(user.role, view);
}
