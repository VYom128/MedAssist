import { Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  QUEUE_RULES,
  ROLES,
  type AppointmentPriority,
} from '../../config/constants.js';
import { config } from '../../config/env.js';
import { assertCanViewAppointment } from '../../policies/appointmentAccess.js';
import { assertCanViewDoctorQueue } from '../../policies/doctorAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDaysToDate, clinicToday, startOfClinicDay } from '../../utils/dates.js';
import { isKioskKey } from '../../utils/kioskKey.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { Appointment } from '../appointments/model.js';
import { viewForRole } from '../appointments/serializer.js';
import {
  announceAppointment,
  loadAppointment,
  requireStaffReason,
  resourceOf,
} from '../appointments/service.js';
import { slotMinutesOf } from '../appointments/slots.service.js';
import { afterConsultationStarted, beginConsultation } from '../appointments/status.service.js';
import { DoctorProfile } from '../doctors/model.js';
import { findDoctor } from '../doctors/service.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { orderQueue } from './ordering.js';
import { toQueueItem, type QueueAppointment } from './serializer.js';
import type { PriorityInput, QueueQuery } from './validation.js';

/** Queue statuses shown on a day's queue: waiting, with the doctor, done. */
const QUEUE_STATUSES = ['checked_in', 'in_consultation', 'completed'] as const;

/** `[start, end)` of a clinic day as UTC instants. */
const dayRange = (date: string, timezone: string) => ({
  $gte: startOfClinicDay(date, timezone),
  $lt: startOfClinicDay(addDaysToDate(date, 1), timezone),
});

/** A doctor's checked-in, in-consultation and completed appointments on a clinic day. */
async function dayAppointments(doctorId: string, date: string, timezone: string) {
  const items = await Appointment.find({
    doctor: doctorId,
    status: { $in: QUEUE_STATUSES },
    startAt: dayRange(date, timezone),
  })
    .select('appointmentNumber status type priority isOverbook startAt patient queue')
    .populate({ path: 'patient', select: 'firstName lastName mrn' })
    .lean();
  return items as unknown as QueueAppointment[];
}

/**
 * The doctor's average consultation (startedAt → completedAt) over the last 30 days, in whole
 * minutes; the slot length when there is no history yet (spec §8.4).
 */
export async function averageConsultMinutes(
  doctorId: string,
  fallbackMinutes: number,
  now = new Date(),
): Promise<{ minutes: number; basis: 'history' | 'slot' }> {
  const since = new Date(now.getTime() - QUEUE_RULES.averageWindowDays * 86_400_000);
  const [row] = await Appointment.aggregate<{ avgMs: number | null }>([
    {
      $match: {
        doctor: new Types.ObjectId(doctorId),
        status: 'completed',
        'queue.startedAt': { $type: 'date' },
        'queue.completedAt': { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        avgMs: { $avg: { $subtract: ['$queue.completedAt', '$queue.startedAt'] } },
      },
    },
  ]);
  if (!row?.avgMs || row.avgMs <= 0) return { minutes: fallbackMinutes, basis: 'slot' };
  return { minutes: Math.max(1, Math.round(row.avgMs / 60_000)), basis: 'history' };
}

/**
 * A doctor's queue for a clinic date, split into waiting (in queue order, with position and
 * estimated wait), in consultation and done (latest first). Estimated wait = patients ahead
 * (waiting before them plus whoever is with the doctor) × the average consultation.
 */
async function buildQueue(doctorId: string, date: string, now = new Date()) {
  const settings = await getSettings();
  const doctor = await findDoctor(doctorId);
  const appointments = await dayAppointments(doctorId, date, settings.timezone);
  const average = await averageConsultMinutes(doctorId, slotMinutesOf(doctor, settings), now);

  const waiting = orderQueue(appointments.filter((a) => a.status === 'checked_in'));
  const inConsultation = appointments.filter((a) => a.status === 'in_consultation');
  const done = appointments
    .filter((a) => a.status === 'completed')
    .sort(
      (a, b) => (b.queue?.completedAt?.getTime() ?? 0) - (a.queue?.completedAt?.getTime() ?? 0),
    );

  return {
    doctor: {
      id: doctorId,
      name: `${doctor.user.firstName} ${doctor.user.lastName}`,
      roomNumber: doctor.roomNumber ?? null,
    },
    date,
    averageConsultMinutes: average.minutes,
    averageBasis: average.basis,
    waiting: waiting.map((a, i) =>
      toQueueItem(a, now, {
        position: i + 1,
        estimatedWaitMinutes: (i + inConsultation.length) * average.minutes,
      }),
    ),
    inConsultation: inConsultation.map((a) => toQueueItem(a, now)),
    done: done.map((a) => toQueueItem(a, now)),
  };
}

/**
 * GET /queue?doctor&date (spec §7.9) – reception and admins for any doctor (`doctor` required);
 * a doctor for themselves (another doctor → 403). `date` defaults to today (clinic time).
 */
export async function getQueue(user: AuthUser, query: QueueQuery, meta: RequestMeta) {
  const doctorId = query.doctor ?? (user.role === ROLES.DOCTOR ? user.id : undefined);
  if (!doctorId) {
    throw ApiError.validation('Validation failed', [
      { field: 'query.doctor', message: 'Required' },
    ]);
  }
  await assertCanViewDoctorQueue(user, doctorId, meta);
  const { timezone } = await getSettings();
  return buildQueue(doctorId, query.date ?? clinicToday(timezone));
}

/**
 * POST /queue/call-next (doctor) – the first waiting patient of the calling doctor today moves
 * into consultation (like start). 409 when the doctor already has a patient in consultation;
 * `null` when nobody is waiting.
 */
export async function callNext(user: AuthUser, meta: RequestMeta) {
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const started = await beginConsultation(user.id, user.id, async (session) => {
    const waiting = await Appointment.find({
      doctor: user.id,
      status: 'checked_in',
      startAt: dayRange(today, timezone),
    })
      .select('status type priority isOverbook startAt queue')
      .session(session)
      .lean();
    return orderQueue(waiting)[0] ?? null;
  });
  if (!started) return null;
  await afterConsultationStarted(user, started, meta, 'call_next');
  return viewForRole(user.role, started);
}

/**
 * POST /queue/:appointmentId/priority (reception) – re-prioritise a checked-in patient with a
 * reason (kept in `priorityHistory`; the audit entry records only that one was given).
 */
export async function setPriority(
  user: AuthUser,
  appointmentId: string,
  input: PriorityInput,
  meta: RequestMeta,
) {
  requireStaffReason(input.reason);
  const appt = await loadAppointment(appointmentId);
  await assertCanViewAppointment(user, appt, meta);
  if (appt.status !== 'checked_in') {
    throw ApiError.unprocessable(
      'Queue priority can only be changed while the patient is waiting (checked in)',
    );
  }
  if (appt.priority === input.priority) {
    throw ApiError.unprocessable(`The priority is already ${input.priority}`);
  }
  const updated = await Appointment.findOneAndUpdate(
    { _id: appt._id, status: 'checked_in', priority: appt.priority },
    {
      $set: { priority: input.priority, updatedBy: user.id },
      $push: {
        priorityHistory: {
          from: appt.priority,
          to: input.priority,
          by: user.id,
          at: new Date(),
          reason: input.reason,
        },
      },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!updated)
    throw ApiError.conflict('The appointment changed meanwhile. Refresh and try again.');

  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_PRIORITY_CHANGE,
    actor: actorOf(user),
    resource: resourceOf(appt),
    patient: appt.patient._id,
    request: meta,
    changes: {
      fields: ['priority'],
      before: { priority: appt.priority },
      after: { priority: input.priority as AppointmentPriority },
    },
    metadata: { reasonGiven: true },
  });
  const view = await loadAppointment(appt._id);
  void announceAppointment(view);
  return viewForRole(user.role, view);
}

/**
 * GET /queue/my-position (patient) – the patient's place in today's queue: token, position among
 * those waiting (0 = with the doctor now), patients ahead and the estimated wait. `null` when
 * they are not checked in today.
 */
export async function myPosition(user: AuthUser) {
  const patientId = await resolveMyPatientId(user);
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const mine = await Appointment.findOne({
    patient: patientId,
    status: { $in: ['checked_in', 'in_consultation'] },
    startAt: dayRange(today, timezone),
  })
    .sort({ status: -1, startAt: 1 }) // in consultation first
    .lean();
  if (!mine) return null;

  const queue = await buildQueue(mine.doctor.toString(), today);
  const id = mine._id.toString();
  const waitingItem = queue.waiting.find((w) => w.appointmentId === id);
  const patientsAhead = waitingItem ? waitingItem.position! - 1 + queue.inConsultation.length : 0;
  return {
    appointmentId: id,
    appointmentNumber: mine.appointmentNumber,
    tokenNumber: mine.queue?.tokenNumber ?? null,
    status: mine.status,
    position: waitingItem?.position ?? 0,
    patientsAhead,
    estimatedWaitMinutes: waitingItem?.estimatedWaitMinutes ?? 0,
    doctor: { id: queue.doctor.id, name: queue.doctor.name, roomNumber: queue.doctor.roomNumber },
    checkedInAt: mine.queue?.checkedInAt ?? null,
  };
}

/**
 * GET /queue/board?key= (public kiosk, spec §4.6 step 6, §7.9) – today, for each active doctor
 * with appointments today: name, room, the token in consultation and the next five waiting
 * tokens. No patient names and no ids. 404 when no KIOSK_KEY is configured; 401 for a wrong key.
 */
export async function getBoard(key: string | undefined) {
  if (!config.kiosk.key) throw ApiError.notFound('The queue board is not set up');
  if (!isKioskKey(key)) {
    throw new ApiError(401, 'Invalid kiosk key', ERROR_CODES.UNAUTHORIZED);
  }
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const appointments = await Appointment.find({
    status: { $in: ['scheduled', ...QUEUE_STATUSES] },
    startAt: dayRange(today, timezone),
  })
    .select('doctor status type priority startAt queue')
    .lean();

  const doctorIds = [...new Set(appointments.map((a) => a.doctor.toString()))];
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: doctorIds }, isActive: true })
      .select('firstName lastName')
      .lean(),
    DoctorProfile.find({ user: { $in: doctorIds } })
      .select('user roomNumber')
      .lean(),
  ]);
  const rooms = new Map(profiles.map((p) => [p.user.toString(), p.roomNumber ?? null]));

  const doctors = users
    .map((u) => {
      const mine = appointments.filter((a) => a.doctor.equals(u._id));
      const current = mine
        .filter((a) => a.status === 'in_consultation')
        .sort(
          (a, b) => (b.queue?.startedAt?.getTime() ?? 0) - (a.queue?.startedAt?.getTime() ?? 0),
        )[0];
      const waiting = orderQueue(mine.filter((a) => a.status === 'checked_in'));
      return {
        doctorName: `${u.firstName} ${u.lastName}`,
        roomNumber: rooms.get(u._id.toString()) ?? null,
        nowServing: current?.queue?.tokenNumber ?? null,
        next: waiting
          .slice(0, QUEUE_RULES.boardNextTokens)
          .map((a) => a.queue?.tokenNumber ?? null)
          .filter((t): t is number => t !== null),
        waitingCount: waiting.length,
      };
    })
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName));

  return { date: today, updatedAt: new Date(), doctors };
}
