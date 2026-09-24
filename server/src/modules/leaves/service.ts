import type { FilterQuery } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  MAX_LEAVE_DAYS,
  NOTIFICATION_TYPES,
  ROLES,
} from '../../config/constants.js';
import { assertCanManageDoctor, assertCanViewDoctorSchedule } from '../../policies/doctorAccess.js';
import * as audit from '../../services/audit.service.js';
import { notify } from '../../services/notification.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  addDaysToDate,
  clinicToday,
  formatClinicDateTime,
  startOfClinicDay,
} from '../../utils/dates.js';
import { logger, serializeError } from '../../utils/logger.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { withTransaction } from '../../utils/transaction.js';
import { leaveImpact, toAffectedItem } from '../appointments/impact.js';
import { DoctorProfile } from '../doctors/model.js';
import { findDoctor } from '../doctors/service.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { DoctorLeave, type DoctorLeaveDoc } from './model.js';
import { toLeaveView, type LeaveLike } from './serializer.js';
import type { CreateLeaveInput, ListLeavesQuery } from './validation.js';

const DAY_MS = 24 * 60 * 60_000;

const rule = (field: string, message: string, summary = message) =>
  ApiError.unprocessable(summary, [{ field: `body.${field}`, message }]);

/**
 * GET /doctors/:id/leaves – leave overlapping `from`..`to` (clinic dates; `from` defaults to
 * today, so past leave is hidden unless asked for). Cancelled leave only with `includeCancelled`.
 */
export async function listLeaves(
  user: AuthUser,
  doctorId: string,
  query: ListLeavesQuery,
  { page, limit, skip }: Pagination,
  meta: RequestMeta,
) {
  await assertCanViewDoctorSchedule(user, doctorId, meta);
  await findDoctor(doctorId);
  const { timezone } = await getSettings();
  const from = startOfClinicDay(query.from ?? clinicToday(timezone), timezone);

  const filter: FilterQuery<DoctorLeaveDoc> = { doctor: doctorId, endAt: { $gt: from } };
  if (query.to) filter.startAt = { $lt: startOfClinicDay(addDaysToDate(query.to, 1), timezone) };
  if (!query.includeCancelled) filter.isCancelled = false;

  const [items, total] = await Promise.all([
    DoctorLeave.find(filter).sort({ startAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    DoctorLeave.countDocuments(filter),
  ]);
  return {
    items: items.map((l) => toLeaveView(l as LeaveLike)),
    meta: buildMeta({ page, limit, total }),
  };
}

/**
 * POST /doctors/:id/leaves (spec §4.13). Full days are converted with the clinic timezone. Rules:
 * end after start; at most MAX_LEAVE_DAYS; not in the past (may start earlier today); no overlap
 * with the doctor's other non-cancelled leave (409); not over appointments in consultation or
 * completed (409). The checks and the insert run in a transaction that bumps the doctor's
 * lockVersion and bookingVersion, so overlapping leave requests and bookings cannot both succeed.
 * Returns the scheduled/checked-in appointments in the period (`affectedAppointments`) and emails
 * reception about them.
 */
export async function createLeave(
  user: AuthUser,
  doctorId: string,
  input: CreateLeaveInput,
  meta: RequestMeta,
) {
  await assertCanManageDoctor(user, doctorId, meta);
  const profile = await findDoctor(doctorId);
  const { timezone } = await getSettings();

  const fullDay = Boolean(input.date);
  const startAt = fullDay ? startOfClinicDay(input.date!, timezone) : new Date(input.startAt!);
  const endAt = fullDay
    ? startOfClinicDay(addDaysToDate(input.endDate ?? input.date!, 1), timezone)
    : new Date(input.endAt!);

  if (endAt <= startAt)
    throw rule('endAt', 'Must be after startAt', 'Leave must end after it starts');
  if (endAt.getTime() - startAt.getTime() > MAX_LEAVE_DAYS * DAY_MS) {
    throw rule(fullDay ? 'endDate' : 'endAt', `Leave can be at most ${MAX_LEAVE_DAYS} days`);
  }
  const todayStart = startOfClinicDay(clinicToday(timezone), timezone);
  if (startAt < todayStart || endAt <= new Date()) {
    throw rule(fullDay ? 'date' : 'startAt', 'Leave cannot be in the past');
  }

  const { leave: created, affected } = await withTransaction(async (session) => {
    // lockVersion serialises leave writes; bookingVersion is the booking lock, so no appointment
    // can be booked into this period while the leave is being saved (and vice versa).
    await DoctorProfile.updateOne(
      { _id: profile._id },
      { $inc: { lockVersion: 1, bookingVersion: 1 } },
      { session },
    );
    const clash = await DoctorLeave.findOne({
      doctor: doctorId,
      isCancelled: false,
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
    })
      .session(session)
      .lean();
    if (clash) {
      throw ApiError.conflict('This overlaps leave the doctor already has', {
        leaveId: clash._id.toString(),
        startAt: clash.startAt,
        endAt: clash.endAt,
      });
    }
    const impact = await leaveImpact(doctorId, { startAt, endAt }, session);
    if (impact.blocking.length > 0) {
      throw ApiError.conflict(
        'The doctor has appointments in consultation or completed in this period',
        { appointments: impact.blocking.map((a) => a.appointmentNumber) },
      );
    }
    const [leave] = await DoctorLeave.create(
      [
        {
          doctor: doctorId,
          startAt,
          endAt,
          type: input.type,
          reason: input.reason ?? undefined,
          createdBy: user.id,
        },
      ],
      { session },
    );
    return { leave: leave!.toObject() as LeaveLike, affected: impact.affected };
  });

  await audit.record({
    action: AUDIT_ACTIONS.DOCTOR_LEAVE_CREATE,
    actor: actorOf(user),
    resource: { type: 'doctor_leave', id: created._id },
    request: meta,
    metadata: {
      doctor: doctorId,
      type: created.type,
      startAt,
      endAt,
      affectedAppointments: affected.length,
    },
  });
  if (affected.length > 0) {
    void notifyReceptionOfLeave(
      `${profile.user.firstName} ${profile.user.lastName}`,
      { startAt, endAt },
      affected.length,
      timezone,
    );
  }
  return { leave: toLeaveView(created), affectedAppointments: affected.map(toAffectedItem) };
}

/**
 * Tells receptionists (spec §4.13 step 2) that leave affects booked appointments, so they
 * reschedule or cancel them. Staff-only email: the doctor, the period and a count – no patient
 * details. Never throws.
 */
async function notifyReceptionOfLeave(
  doctorName: string,
  range: { startAt: Date; endAt: Date },
  count: number,
  timezone: string,
) {
  try {
    const receptionists = await User.find({ role: ROLES.RECEPTIONIST, isActive: true })
      .select('email')
      .lean();
    const period = `${formatClinicDateTime(range.startAt, timezone)} to ${formatClinicDateTime(range.endAt, timezone)}`;
    await notify({
      recipients: receptionists.map((r) => ({ userId: r._id.toString(), email: r.email })),
      type: NOTIFICATION_TYPES.LEAVE_AFFECTS_APPOINTMENTS,
      title: 'Doctor leave affects booked appointments',
      body:
        `${doctorName} will be on leave from ${period}. ` +
        `${count} booked appointment${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} to be rescheduled or cancelled.`,
      link: '/reception/appointments',
      email: true,
    });
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Leave notification failed');
  }
}

/** POST /doctors/:id/leaves/:leaveId/cancel – only leave that has not ended yet. */
export async function cancelLeave(
  user: AuthUser,
  doctorId: string,
  leaveId: string,
  meta: RequestMeta,
) {
  await assertCanManageDoctor(user, doctorId, meta);
  const leave = (await DoctorLeave.findOne({
    _id: leaveId,
    doctor: doctorId,
  }).lean()) as LeaveLike | null;
  if (!leave) throw ApiError.notFound('Leave not found');
  if (leave.isCancelled) {
    throw new ApiError(409, 'Leave is already cancelled', ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  if (leave.endAt <= new Date()) throw ApiError.unprocessable('This leave has already ended');

  const updated = (await DoctorLeave.findOneAndUpdate(
    { _id: leaveId, isCancelled: false },
    { $set: { isCancelled: true, cancelledAt: new Date(), cancelledBy: user.id } },
    { new: true },
  ).lean()) as LeaveLike | null;
  if (!updated) {
    throw new ApiError(409, 'Leave is already cancelled', ERROR_CODES.INVALID_STATUS_TRANSITION);
  }
  await audit.record({
    action: AUDIT_ACTIONS.DOCTOR_LEAVE_CANCEL,
    actor: actorOf(user),
    resource: { type: 'doctor_leave', id: leaveId },
    request: meta,
    changes: audit.diffChanges({ isCancelled: false }, { isCancelled: true }, ['isCancelled']),
    metadata: { doctor: doctorId },
  });
  return toLeaveView(updated);
}
