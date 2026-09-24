import type { ClientSession, Types } from 'mongoose';
import { ERROR_CODES, ROLES } from '../../config/constants.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  addDaysToDate,
  clinicToday,
  daysBetween,
  startOfClinicDay,
  weekdayOf,
} from '../../utils/dates.js';
import { findDoctor } from '../doctors/service.js';
import { DoctorLeave } from '../leaves/model.js';
import {
  getScheduleForDate,
  getSchedulesForRange,
  type DaySchedule,
} from '../schedules/service.js';
import { Service } from '../services/model.js';
import { getSettings } from '../settings/service.js';
import { Appointment } from './model.js';
import { generateSlots, type TimeRange } from './slots.js';
import type { AvailabilityQuery, SlotsQuery } from './validation.js';

/**
 * Loading side of slot generation (spec §8.1, §7.6): reads the doctor, settings, schedule, leave
 * and bookings, and hands them to the pure engine in slots.ts. Booking re-uses these helpers
 * inside its transaction.
 */

type Settings = Awaited<ReturnType<typeof getSettings>>;
export type BookableDoctor = Awaited<ReturnType<typeof findDoctor>>;
export interface ServiceLike {
  _id: Types.ObjectId;
  name: string;
  durationMinutes: number;
  pricePaise: number;
  department?: Types.ObjectId | null;
  isActive: boolean;
}

const isPatient = (user: Pick<AuthUser, 'role'>) => user.role === ROLES.PATIENT;

/** The doctor's slot length: their own setting, else the clinic default. */
export const slotMinutesOf = (doctor: BookableDoctor, settings: Settings) =>
  doctor.slotMinutes ?? settings.appointment!.defaultSlotMinutes;

/** Active doctor who is accepting appointments. */
export const isBookable = (doctor: BookableDoctor) =>
  doctor.user.isActive && doctor.isAcceptingAppointments;

/** The day's schedule, or null when the clinic is closed that weekday (settings.workingDays). */
export const workingSchedule = (settings: Settings, date: string, schedule: DaySchedule | null) =>
  settings.workingDays?.includes(weekdayOf(date)) === false ? null : schedule;

/**
 * An active service the doctor can provide. 404 if missing or inactive; 422 if it belongs to a
 * different department (services without a department are clinic-wide).
 */
export async function loadService(serviceId: string | Types.ObjectId, doctor: BookableDoctor) {
  const service = (await Service.findById(serviceId).lean()) as ServiceLike | null;
  if (!service || !service.isActive) throw ApiError.notFound('Service not found');
  const doctorDept = doctor.department?._id.toString();
  if (service.department && service.department.toString() !== doctorDept) {
    throw ApiError.unprocessable('This doctor does not offer that service', [
      { field: 'body.serviceId', message: "Not a service of the doctor's department" },
    ]);
  }
  return service;
}

/**
 * Booking window (spec §8.1 step 1): never in the past; patients at most `bookingWindowDays`
 * ahead, staff any distance. 422 OUTSIDE_BOOKING_WINDOW.
 */
export function assertInBookingWindow(
  user: Pick<AuthUser, 'role'>,
  date: string,
  today: string,
  settings: Settings,
) {
  if (date < today) {
    throw new ApiError(422, 'That date is in the past', ERROR_CODES.OUTSIDE_BOOKING_WINDOW, {
      date,
      today,
    });
  }
  const windowDays = settings.appointment!.bookingWindowDays;
  if (isPatient(user) && daysBetween(today, date) > windowDays) {
    throw new ApiError(
      422,
      `Appointments can be booked up to ${windowDays} days ahead`,
      ERROR_CODES.OUTSIDE_BOOKING_WINDOW,
      { date, lastDate: addDaysToDate(today, windowDays) },
    );
  }
}

const rangeQuery = (doctorId: string | Types.ObjectId, from: Date, to: Date) => ({
  doctor: doctorId,
  startAt: { $lt: to },
  endAt: { $gt: from },
});

/** The doctor's non-cancelled leave overlapping `[from, to)`. */
export async function leavesBetween(
  doctorId: string | Types.ObjectId,
  from: Date,
  to: Date,
  session?: ClientSession,
): Promise<TimeRange[]> {
  return DoctorLeave.find({ ...rangeQuery(doctorId, from, to), isCancelled: false })
    .select('startAt endAt')
    .session(session ?? null)
    .lean();
}

/** Appointments holding one of the doctor's slots (`isSlotActive`) overlapping `[from, to)`. */
export async function bookedBetween(
  doctorId: string | Types.ObjectId,
  from: Date,
  to: Date,
  { session, excludeId }: { session?: ClientSession; excludeId?: Types.ObjectId } = {},
): Promise<TimeRange[]> {
  return Appointment.find({
    ...rangeQuery(doctorId, from, to),
    isSlotActive: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('startAt endAt')
    .session(session ?? null)
    .lean();
}

/**
 * GET /doctors/:id/slots?date&serviceId – free slots (spec §8.1). 422 OUTSIDE_BOOKING_WINDOW
 * for past dates (and, for patients, beyond the booking window); an empty list for non-working
 * days, full-day leave, inactive doctors or doctors not accepting appointments.
 */
export async function getSlots(user: AuthUser, doctorId: string, query: SlotsQuery) {
  const doctor = await findDoctor(doctorId);
  const settings = await getSettings();
  const { timezone } = settings;
  const now = new Date();
  assertInBookingWindow(user, query.date, clinicToday(timezone, now), settings);
  const service = query.serviceId ? await loadService(query.serviceId, doctor) : null;
  const slotMinutes = slotMinutesOf(doctor, settings);
  const serviceMinutes = service?.durationMinutes ?? slotMinutes;
  const result = { date: query.date, timezone, slotMinutes, serviceMinutes };
  if (!isBookable(doctor)) return { ...result, slots: [] };

  const dayStart = startOfClinicDay(query.date, timezone);
  const dayEnd = startOfClinicDay(addDaysToDate(query.date, 1), timezone);
  const [schedule, leaves, booked] = await Promise.all([
    getScheduleForDate(doctorId, query.date),
    leavesBetween(doctorId, dayStart, dayEnd),
    bookedBetween(doctorId, dayStart, dayEnd),
  ]);
  const slots = generateSlots({
    date: query.date,
    schedule: workingSchedule(settings, query.date, schedule),
    slotMinutes,
    serviceMinutes,
    leaves,
    booked,
    now,
    timezone,
  });
  return { ...result, slots };
}

/**
 * GET /doctors/:id/availability?from&to&serviceId – free slots per day for date pickers. One
 * query each for schedules, leave and bookings over the whole range. Days in the past (and, for
 * patients, beyond the booking window) have 0.
 */
export async function getAvailability(user: AuthUser, doctorId: string, query: AvailabilityQuery) {
  const doctor = await findDoctor(doctorId);
  const settings = await getSettings();
  const { timezone } = settings;
  const now = new Date();
  const today = clinicToday(timezone, now);
  const service = query.serviceId ? await loadService(query.serviceId, doctor) : null;
  const slotMinutes = slotMinutesOf(doctor, settings);
  const serviceMinutes = service?.durationMinutes ?? slotMinutes;
  const lastDate = isPatient(user)
    ? addDaysToDate(today, settings.appointment!.bookingWindowDays)
    : query.to;

  const rangeStart = startOfClinicDay(query.from, timezone);
  const rangeEnd = startOfClinicDay(addDaysToDate(query.to, 1), timezone);
  const [schedules, leaves, booked] = isBookable(doctor)
    ? await Promise.all([
        getSchedulesForRange(doctorId, query.from, query.to),
        leavesBetween(doctorId, rangeStart, rangeEnd),
        bookedBetween(doctorId, rangeStart, rangeEnd),
      ])
    : [new Map<string, DaySchedule | null>(), [], []];

  const days: { date: string; freeSlots: number }[] = [];
  for (let date = query.from; date <= query.to; date = addDaysToDate(date, 1)) {
    const open = isBookable(doctor) && date >= today && date <= lastDate;
    const freeSlots = open
      ? generateSlots({
          date,
          schedule: workingSchedule(settings, date, schedules.get(date) ?? null),
          slotMinutes,
          serviceMinutes,
          leaves,
          booked,
          now,
          timezone,
        }).length
      : 0;
    days.push({ date, freeSlots });
  }
  return { timezone, slotMinutes, serviceMinutes, days };
}
