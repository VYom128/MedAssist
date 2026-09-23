import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { getClinicTimezone } from './clinicTimezone';

/**
 * Dates in the clinic timezone (spec §3.7, §13.3: "05 Oct 2026, 9:00 AM"). The timezone comes
 * from the public clinic settings; `timeZone` overrides it.
 */

type DateInput = string | Date | null | undefined;

const valid = (value: DateInput): Date | null => {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "05 Oct 2026" */
export function formatDate(value: DateInput, timeZone = getClinicTimezone()): string {
  const d = valid(value);
  return d ? formatInTimeZone(d, timeZone, 'dd MMM yyyy') : '—';
}

/** "05 Oct 2026, 9:00 AM" */
export function formatDateTime(value: DateInput, timeZone = getClinicTimezone()): string {
  const d = valid(value);
  return d ? formatInTimeZone(d, timeZone, 'dd MMM yyyy, h:mm a') : '—';
}

/** "9:00 AM" */
export function formatTime(value: DateInput, timeZone = getClinicTimezone()): string {
  const d = valid(value);
  return d ? formatInTimeZone(d, timeZone, 'h:mm a') : '—';
}

/** "09:00" (24-hour) → "9:00 AM", for schedule session times. */
export function formatClockTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The clinic calendar date ('YYYY-MM-DD') of an instant (default now). */
export function clinicDate(value: Date | string = new Date(), timeZone = getClinicTimezone()) {
  return formatInTimeZone(valid(value) ?? new Date(), timeZone, 'yyyy-MM-dd');
}

/**
 * A clinic wall-clock date and time as a UTC ISO string:
 * ('2026-10-05', '09:00') in Asia/Kolkata → '2026-10-05T03:30:00.000Z'.
 */
export function toUtcFromClinic(date: string, time = '00:00', timeZone = getClinicTimezone()) {
  return fromZonedTime(`${date}T${time}:00`, timeZone).toISOString();
}

/** UTC offset like "+05:30" of `timeZone` at `date`. */
export function timeZoneOffset(date: Date, timeZone = getClinicTimezone()): string {
  const offset = formatInTimeZone(date, timeZone, 'xxx');
  return offset === 'Z' ? '+00:00' : offset;
}

/**
 * ISO date-time with offset for the start or end of a clinic-timezone day (`YYYY-MM-DD`), for
 * `from` / `to` filters.
 */
export function clinicDayBoundary(
  day: string,
  edge: 'start' | 'end',
  timeZone = getClinicTimezone(),
) {
  const offset = timeZoneOffset(new Date(`${day}T12:00:00Z`), timeZone);
  return `${day}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}${offset}`;
}

/** 'YYYY-MM-DD' shifted by whole days (calendar arithmetic, no timezone). */
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'HH:mm' → minutes since midnight. */
export const minutesOf = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
