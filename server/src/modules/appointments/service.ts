import type { FilterQuery, Types } from 'mongoose';
import {
  APPOINTMENT_RULES,
  AUDIT_ACTIONS,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  ROLES,
} from '../../config/constants.js';
import {
  appointmentListFilter,
  assertCanViewAppointment,
} from '../../policies/appointmentAccess.js';
import * as audit from '../../services/audit.service.js';
import { notificationLink, notify, type Recipient } from '../../services/notification.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  addDaysToDate,
  clinicToday,
  formatClinicDateTime,
  startOfClinicDay,
  toClinicDate,
} from '../../utils/dates.js';
import { logger, serializeError } from '../../utils/logger.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { buildPatientSearchQuery } from '../../utils/search.js';
import { emitAppointmentChanged, emitQueueUpdated } from '../../socket/emitter.js';
import { Patient } from '../patients/model.js';
import { orderQueue } from '../queue/ordering.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { Appointment, type AppointmentDoc } from './model.js';
import { POPULATE, toCalendarEvent, viewForRole, type AppointmentLike } from './serializer.js';
import type { CalendarQuery, ListAppointmentsQuery, UpdateAppointmentInput } from './validation.js';

type Settings = Awaited<ReturnType<typeof getSettings>>;

/** Audit resource of an appointment. */
export const resourceOf = (a: { _id: Types.ObjectId; appointmentNumber: string }) => ({
  type: 'appointment',
  id: a._id,
  number: a.appointmentNumber,
});

/** An appointment with patient, doctor and department populated. 404 if missing. */
export async function loadAppointment(id: string | Types.ObjectId): Promise<AppointmentLike> {
  const a = await Appointment.findById(id)
    .populate([...POPULATE])
    .lean();
  if (!a) throw ApiError.notFound('Appointment not found');
  return a as unknown as AppointmentLike;
}

/** Staff must say why they reschedule or cancel (spec §8.3). */
export function requireStaffReason(reason: string | null | undefined) {
  if (!reason || reason.length < APPOINTMENT_RULES.reasonMinLength) {
    throw ApiError.validation('Validation failed', [
      {
        field: 'body.reason',
        message: `Give a reason (at least ${APPOINTMENT_RULES.reasonMinLength} characters)`,
      },
    ]);
  }
}

/**
 * Patients may reschedule or cancel online only until `minCancelHours` before the start
 * (spec §8.3) → 422 CANCELLATION_WINDOW_PASSED.
 */
export function assertPatientMayChange(startAt: Date, settings: Settings, now = new Date()) {
  const hours = settings.appointment!.minCancelHours;
  if (startAt.getTime() - now.getTime() < hours * 3_600_000) {
    throw new ApiError(
      422,
      `Appointments can only be changed online up to ${hours} hours before they start. ` +
        'Please call the clinic.',
      ERROR_CODES.CANCELLATION_WINDOW_PASSED,
      { minCancelHours: hours },
    );
  }
}

// ---- Notifications -------------------------------------------------------------------------

/** Notifications about one appointment. */
type AppointmentNotification =
  | typeof NOTIFICATION_TYPES.APPOINTMENT_BOOKED
  | typeof NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED
  | typeof NOTIFICATION_TYPES.APPOINTMENT_CANCELLED
  | typeof NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW
  | typeof NOTIFICATION_TYPES.APPOINTMENT_REMINDER;

const PATIENT_MESSAGES: Record<
  AppointmentNotification,
  { title: string; body: (n: string, when: string) => string }
> = {
  [NOTIFICATION_TYPES.APPOINTMENT_BOOKED]: {
    title: 'Appointment confirmed',
    body: (n, when) => `Your appointment ${n} is booked for ${when}.`,
  },
  [NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED]: {
    title: 'Appointment rescheduled',
    body: (n, when) => `Your appointment ${n} has been moved to ${when}.`,
  },
  [NOTIFICATION_TYPES.APPOINTMENT_CANCELLED]: {
    title: 'Appointment cancelled',
    body: (n, when) => `Your appointment ${n} on ${when} has been cancelled.`,
  },
  [NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW]: {
    title: 'Missed appointment',
    body: (n, when) =>
      `We missed you at your appointment ${n} on ${when}. Please contact the clinic to book again.`,
  },
  [NOTIFICATION_TYPES.APPOINTMENT_REMINDER]: {
    title: 'Appointment reminder',
    body: (n, when) => `Reminder: your appointment ${n} is on ${when}.`,
  },
};

/** What same-day emails tell the doctor (reminders go to patients only). */
const DOCTOR_VERBS: Partial<Record<AppointmentNotification, string>> = {
  [NOTIFICATION_TYPES.APPOINTMENT_BOOKED]: 'booked',
  [NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED]: 'moved',
  [NOTIFICATION_TYPES.APPOINTMENT_CANCELLED]: 'cancelled',
  [NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW]: 'marked as a no-show',
};

/**
 * The patient as a recipient: their portal user (in-app) and an email only with email consent
 * (`consent.communications.email` true, spec §11).
 */
export async function patientRecipient(patientId: Types.ObjectId | string): Promise<Recipient> {
  const p = await Patient.findById(patientId).select('email user consent').lean();
  if (!p) return {};
  const account = p.user ? await User.findById(p.user).select('email').lean() : null;
  const emailAllowed = p.consent?.communications?.email === true;
  return {
    userId: p.user?.toString() ?? null,
    email: emailAllowed ? (p.email ?? account?.email ?? null) : null,
  };
}

/** The ids, number and time of an appointment – all a notification may carry about it. */
const appointmentData = (a: AppointmentLike) => ({
  appointmentId: a._id.toString(),
  appointmentNumber: a.appointmentNumber,
  startAt: a.startAt.toISOString(),
  status: a.status,
});

/**
 * One notification per event: booking, cancellation, no-show and reminder happen once per
 * appointment; a reschedule once per new start time.
 */
const appointmentDedupeKey = (type: AppointmentNotification, a: AppointmentLike) =>
  type === NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED
    ? `${type}:${a._id.toString()}:${a.startAt.toISOString()}`
    : `${type}:${a._id.toString()}`;

/**
 * Tells the patient (and the doctor, for same-day changes – spec §4.5, §11) about a booking,
 * reschedule, cancellation, no-show or reminder. Never blocks or throws. Only the appointment
 * number and time – no doctor, department or reason (§10.3).
 */
export async function notifyAppointment(
  type: AppointmentNotification,
  a: AppointmentLike,
  { notifyDoctorSameDay = false }: { notifyDoctorSameDay?: boolean } = {},
): Promise<void> {
  try {
    const { timezone } = await getSettings();
    const when = formatClinicDateTime(a.startAt, timezone);
    const message = PATIENT_MESSAGES[type];
    const data = appointmentData(a);
    const dedupeKey = appointmentDedupeKey(type, a);
    await notify({
      recipients: [await patientRecipient(a.patient._id)],
      type,
      title: message.title,
      body: message.body(a.appointmentNumber, when),
      link: notificationLink(type, ROLES.PATIENT),
      data,
      dedupeKey,
    });
    const verb = DOCTOR_VERBS[type];
    if (
      verb &&
      notifyDoctorSameDay &&
      toClinicDate(a.startAt, timezone) === clinicToday(timezone)
    ) {
      const doctor = await User.findById(a.doctor._id).select('email').lean();
      await notify({
        recipients: [{ userId: a.doctor._id.toString(), email: doctor?.email ?? null }],
        type,
        title: `Today's appointment ${verb}`,
        body: `Appointment ${a.appointmentNumber} today at ${when} was ${verb}.`,
        link: notificationLink(type, ROLES.DOCTOR, a._id),
        data,
        dedupeKey: `${dedupeKey}:doctor`,
      });
    }
  } catch (err) {
    logger.error({ err: serializeError(err), type }, 'Appointment notification failed');
  }
}

/** "You are checked in" with the token (in-app, spec §11). Never throws. */
export async function notifyCheckedIn(a: AppointmentLike): Promise<void> {
  try {
    const token = a.queue?.tokenNumber ?? null;
    await notify({
      recipients: [await patientRecipient(a.patient._id)],
      type: NOTIFICATION_TYPES.APPOINTMENT_CHECKED_IN,
      title: 'You are checked in',
      body: token
        ? `Your token number is ${token}. We will let you know when you are next.`
        : 'We will let you know when you are next.',
      link: notificationLink(NOTIFICATION_TYPES.APPOINTMENT_CHECKED_IN, ROLES.PATIENT),
      data: { ...appointmentData(a), ...(token ? { tokenNumber: token } : {}) },
      dedupeKey: `${NOTIFICATION_TYPES.APPOINTMENT_CHECKED_IN}:${a._id.toString()}`,
    });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Check-in notification failed');
  }
}

/**
 * "You are next" (in-app, real-time; spec §11): after a consultation starts, the patient now
 * first in the doctor's waiting queue for that clinic day is told – once per appointment.
 * Never throws.
 */
export async function notifyNextInQueue(doctorId: string, startAt: Date): Promise<void> {
  try {
    const { timezone } = await getSettings();
    const date = toClinicDate(startAt, timezone);
    const waiting = await Appointment.find({
      doctor: doctorId,
      status: 'checked_in',
      startAt: {
        $gte: startOfClinicDay(date, timezone),
        $lt: startOfClinicDay(addDaysToDate(date, 1), timezone),
      },
    })
      .select('status type priority isOverbook startAt queue patient appointmentNumber')
      .lean();
    const next = orderQueue(waiting)[0];
    if (!next) return;
    await notify({
      recipients: [await patientRecipient(next.patient)],
      type: NOTIFICATION_TYPES.QUEUE_YOUR_TURN,
      title: 'You are next',
      body: 'You are next in the queue. Please stay close to the consultation room.',
      link: notificationLink(NOTIFICATION_TYPES.QUEUE_YOUR_TURN, ROLES.PATIENT),
      data: {
        appointmentId: next._id.toString(),
        appointmentNumber: next.appointmentNumber,
        position: 1,
        ...(next.queue?.tokenNumber ? { tokenNumber: next.queue.tokenNumber } : {}),
      },
      dedupeKey: `${NOTIFICATION_TYPES.QUEUE_YOUR_TURN}:${next._id.toString()}`,
    });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Queue notification failed');
  }
}

// ---- Real-time events ---------------------------------------------------------------------

type Ref = Types.ObjectId | { _id: Types.ObjectId; user?: Types.ObjectId | null };
const refId = (ref: Ref) => ('_id' in ref ? ref._id : ref).toString();

/**
 * Socket.IO events for a changed appointment, sent after the commit (spec §7.9): `queue.updated`
 * for the doctor's queue on the appointment's clinic day – and for the old doctor/day after a
 * reschedule – and `appointment.changed` to the patient's portal account and the doctor(s).
 * Payloads are ids only. Never throws.
 */
export async function announceAppointment(
  a: { _id: Types.ObjectId; doctor: Ref; patient: Ref; startAt: Date },
  previous?: { doctor: Ref; startAt: Date },
): Promise<void> {
  try {
    const { timezone } = await getSettings();
    const doctors = new Set([refId(a.doctor)]);
    emitQueueUpdated(refId(a.doctor), toClinicDate(a.startAt, timezone));
    if (previous) {
      doctors.add(refId(previous.doctor));
      const before = [refId(previous.doctor), toClinicDate(previous.startAt, timezone)] as const;
      if (before[0] !== refId(a.doctor) || before[1] !== toClinicDate(a.startAt, timezone)) {
        emitQueueUpdated(...before);
      }
    }
    const patientUser =
      '_id' in a.patient && 'user' in a.patient
        ? a.patient.user
        : (await Patient.findById(refId(a.patient)).select('user').lean())?.user;
    emitAppointmentChanged(a._id.toString(), [
      ...doctors,
      ...(patientUser ? [patientUser.toString()] : []),
    ]);
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Appointment real-time event failed');
  }
}

// ---- Reads ---------------------------------------------------------------------------------

/** Patients see their linked record's appointments: 403 PATIENT_LINK_PENDING while pending. */
async function assertPatientLinked(user: AuthUser) {
  if (user.role === ROLES.PATIENT && !user.patientId) await resolveMyPatientId(user);
}

const APPOINTMENT_NUMBER = /^APT-\d{4}-\d{1,9}$/i;

/** `q`: an appointment number (exact); for staff also a patient's name, MRN or phone. */
async function searchFilter(user: AuthUser, q: string): Promise<FilterQuery<AppointmentDoc>> {
  if (APPOINTMENT_NUMBER.test(q)) return { appointmentNumber: q.toUpperCase() };
  if (user.role === ROLES.PATIENT) return { _id: { $in: [] } };
  const search = buildPatientSearchQuery(q);
  if (!search) return {};
  const ids = await Patient.find(search).select('_id').limit(200).lean();
  return { patient: { $in: ids.map((p) => p._id) } };
}

/**
 * GET /appointments (spec §7.8) – role-scoped (admin/reception all, doctor own, patient own).
 * `from`/`to` are clinic dates (inclusive); sorted by `startAt` unless `sort` says otherwise.
 */
export async function listAppointments(
  user: AuthUser,
  query: ListAppointmentsQuery,
  { page, limit, skip }: Pagination,
) {
  await assertPatientLinked(user);
  const { timezone } = await getSettings();
  const and: FilterQuery<AppointmentDoc>[] = [appointmentListFilter(user)];
  const startAt: Record<string, Date> = {};
  if (query.from) startAt.$gte = startOfClinicDay(query.from, timezone);
  if (query.to) startAt.$lt = startOfClinicDay(addDaysToDate(query.to, 1), timezone);
  if (Object.keys(startAt).length > 0) and.push({ startAt });
  if (query.doctor) and.push({ doctor: query.doctor });
  if (query.patient) and.push({ patient: query.patient });
  if (query.department) and.push({ department: query.department });
  if (query.status) and.push({ status: { $in: query.status } });
  if (query.type) and.push({ type: query.type });
  if (query.q) and.push(await searchFilter(user, query.q));

  const filter = { $and: and };
  const [items, total] = await Promise.all([
    Appointment.find(filter)
      .sort(query.sort)
      .skip(skip)
      .limit(limit)
      .populate([...POPULATE])
      .lean(),
    Appointment.countDocuments(filter),
  ]);
  return {
    items: (items as unknown as AppointmentLike[]).map((a) => viewForRole(user.role, a)),
    meta: buildMeta({ page, limit, total }),
  };
}

/** Most events one calendar request returns (31 days of a busy clinic fit easily). */
const CALENDAR_LIMIT = 2000;

/**
 * GET /appointments/calendar?from&to&doctor – compact events for the calendar views (admin,
 * reception; doctors see their own). At most 31 days.
 */
export async function getCalendar(user: AuthUser, query: CalendarQuery) {
  const { timezone } = await getSettings();
  const filter: FilterQuery<AppointmentDoc> = {
    $and: [
      appointmentListFilter(user),
      {
        startAt: {
          $gte: startOfClinicDay(query.from, timezone),
          $lt: startOfClinicDay(addDaysToDate(query.to, 1), timezone),
        },
      },
      ...(query.doctor ? [{ doctor: query.doctor }] : []),
    ],
  };
  const items = await Appointment.find(filter)
    .sort({ startAt: 1, _id: 1 })
    .limit(CALENDAR_LIMIT)
    .populate([...POPULATE])
    .lean();
  return (items as unknown as AppointmentLike[]).map(toCalendarEvent);
}

/** GET /appointments/:id – the caller's view; others' appointments → 404. */
export async function getAppointment(user: AuthUser, id: string, meta: RequestMeta) {
  const a = await loadAppointment(id);
  await assertCanViewAppointment(user, a, meta);
  return viewForRole(user.role, a);
}

// ---- Update --------------------------------------------------------------------------------

/** Statuses in which the stated reason and the priority may still change. */
const EDITABLE_STATUSES = ['scheduled', 'checked_in'] as const;

/**
 * PATCH /appointments/:id (staff) – reason and priority only, while scheduled or checked in.
 * Audited `appointment.update` with the changed field names; the reason's text is redacted
 * (free text), the priority kept.
 */
export async function updateAppointment(
  user: AuthUser,
  id: string,
  input: UpdateAppointmentInput,
  meta: RequestMeta,
) {
  const before = await loadAppointment(id);
  await assertCanViewAppointment(user, before, meta);
  if (!(EDITABLE_STATUSES as readonly string[]).includes(before.status)) {
    throw ApiError.unprocessable(
      `A ${before.status.replace(/_/g, ' ')} appointment can no longer be changed`,
    );
  }
  const set: Record<string, unknown> = { updatedBy: user.id };
  if (input.reason !== undefined) set.reason = input.reason ?? undefined;
  if (input.priority !== undefined) set.priority = input.priority;
  const updated = await Appointment.findOneAndUpdate(
    { _id: before._id, status: { $in: EDITABLE_STATUSES } },
    { $set: set },
    { new: true, runValidators: true },
  )
    .populate([...POPULATE])
    .lean();
  if (!updated)
    throw ApiError.conflict('The appointment changed meanwhile. Refresh and try again.');
  const after = updated as unknown as AppointmentLike;

  const changes = audit.diffChanges(
    { reason: before.reason ?? null, priority: before.priority },
    { reason: after.reason ?? null, priority: after.priority },
    Object.keys(input).filter((k) => k === 'reason' || k === 'priority'),
  );
  if (changes.fields.includes('reason')) {
    changes.before.reason = audit.REDACTED;
    changes.after.reason = audit.REDACTED;
  }
  if (changes.fields.length > 0) {
    await audit.record({
      action: AUDIT_ACTIONS.APPOINTMENT_UPDATE,
      actor: actorOf(user),
      resource: resourceOf(after),
      patient: after.patient._id,
      request: meta,
      changes,
    });
    void announceAppointment(after);
  }
  return viewForRole(user.role, after);
}
