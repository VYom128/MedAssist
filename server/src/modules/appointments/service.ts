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
import { notify, type Recipient } from '../../services/notification.service.js';
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
  | typeof NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW;

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
};

const DOCTOR_VERBS: Record<AppointmentNotification, string> = {
  [NOTIFICATION_TYPES.APPOINTMENT_BOOKED]: 'booked',
  [NOTIFICATION_TYPES.APPOINTMENT_RESCHEDULED]: 'moved',
  [NOTIFICATION_TYPES.APPOINTMENT_CANCELLED]: 'cancelled',
  [NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW]: 'marked as a no-show',
};

/** The patient as a recipient: portal user, and an email unless they opted out of emails. */
async function patientRecipient(patientId: Types.ObjectId): Promise<Recipient> {
  const p = await Patient.findById(patientId).select('email user consent').lean();
  if (!p) return {};
  const account = p.user ? await User.findById(p.user).select('email').lean() : null;
  const emailAllowed = p.consent?.communications?.email !== false;
  return {
    userId: p.user?.toString() ?? null,
    email: emailAllowed ? (p.email ?? account?.email ?? null) : null,
  };
}

/**
 * Tells the patient (and the doctor, for same-day changes – spec §4.5, §11) about a booking,
 * reschedule or cancellation. Never blocks or throws. Emails say only the appointment number
 * and time – no doctor, department or reason (§10.3).
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
    await notify({
      recipients: [await patientRecipient(a.patient._id)],
      type,
      title: message.title,
      body: message.body(a.appointmentNumber, when),
      link: '/patient/appointments',
      email: true,
    });
    if (notifyDoctorSameDay && toClinicDate(a.startAt, timezone) === clinicToday(timezone)) {
      const doctor = await User.findById(a.doctor._id).select('email').lean();
      await notify({
        recipients: [{ userId: a.doctor._id.toString(), email: doctor?.email ?? null }],
        type,
        title: `Today's appointment ${DOCTOR_VERBS[type]}`,
        body: `Appointment ${a.appointmentNumber} today at ${when} was ${DOCTOR_VERBS[type]}.`,
        link: '/doctor/appointments',
        email: true,
      });
    }
  } catch (err) {
    logger.error({ err: serializeError(err), type }, 'Appointment notification failed');
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
