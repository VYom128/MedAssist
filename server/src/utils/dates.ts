import { addDays, format, parseISO, subYears } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { PATIENT_RULES } from '../config/constants.js';

/**
 * Clinic time helpers (spec §3.7): dates are stored in UTC; business days and schedule clock
 * times ('HH:mm') are in the clinic timezone.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a 24-hour 'HH:mm' clock time ('09:00', '23:59'). */
export function isValidTimeHHmm(value: string): boolean {
  return HHMM.test(value);
}

/** 'HH:mm' → minutes since midnight ('09:30' → 570). */
export function timeToMinutes(value: string): number {
  const match = HHMM.exec(value);
  if (!match) throw new RangeError(`Not a valid HH:mm time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight → 'HH:mm' (570 → '09:30'). */
export function minutesToTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new RangeError(`Minutes out of range: ${minutes}`);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

let zones: Set<string> | undefined;

/**
 * True for an IANA timezone the runtime knows ('Asia/Kolkata'), plus 'UTC'. ICU lists canonical
 * names only (it may list 'Asia/Calcutta' rather than 'Asia/Kolkata'), so aliases are resolved
 * first. Abbreviations ('IST') and raw offsets ('+05:30') are rejected.
 */
export function isValidTimezone(value: string): boolean {
  zones ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  if (zones.has(value)) return true;
  // ICU also resolves abbreviations ('IST' → Asia/Calcutta); only accept Area/Location names.
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions()
      .timeZone;
    return zones.has(resolved);
  } catch {
    return false;
  }
}

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const d = parseISO(value);
  return !Number.isNaN(d.getTime()) && format(d, 'yyyy-MM-dd') === value;
}

/**
 * The UTC instant of a wall-clock time in a timezone:
 * ('2026-10-05', '09:00', 'Asia/Kolkata') → 2026-10-05T03:30:00.000Z.
 * In a DST gap (a time that does not exist) the result is shifted forward by the gap.
 */
export function zonedDateTimeToUtc(date: string, time: string, timezone: string): Date {
  if (!isValidDateOnly(date)) throw new RangeError(`Not a valid date: ${date}`);
  if (!isValidTimeHHmm(time)) throw new RangeError(`Not a valid HH:mm time: ${time}`);
  return fromZonedTime(`${date}T${time}:00`, timezone);
}

/** The clinic calendar date ('YYYY-MM-DD') of an instant. */
export function toClinicDate(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, 'yyyy-MM-dd');
}

/** An instant as clinic wall-clock time 'HH:mm'. */
export function toClinicTime(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, 'HH:mm');
}

/** An instant for people (emails): '05 Oct 2026, 9:00 AM' in the clinic timezone (spec §13.3). */
export function formatClinicDateTime(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, 'dd MMM yyyy, h:mm a');
}

/** Whole calendar days from `from` to `to` ('YYYY-MM-DD'; negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((calendarDate(to).getTime() - calendarDate(from).getTime()) / 86_400_000);
}

/** Today's date in the clinic timezone. */
export function clinicToday(timezone: string, now = new Date()): string {
  return toClinicDate(now, timezone);
}

/** 'YYYY-MM-DD' shifted by `days` calendar days. */
export function addDaysToDate(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

const dateStringOf = (date: Date | string, timezone: string) =>
  typeof date === 'string' ? date : toClinicDate(date, timezone);

/**
 * Start of the clinic day containing `date` (a Date, or a 'YYYY-MM-DD' clinic date), as UTC.
 * Handles DST days (23 or 25 hours long).
 */
export function startOfClinicDay(date: Date | string, timezone: string): Date {
  return zonedDateTimeToUtc(dateStringOf(date, timezone), '00:00', timezone);
}

/** Last millisecond of the clinic day containing `date`, as UTC. */
export function endOfClinicDay(date: Date | string, timezone: string): Date {
  const next = addDaysToDate(dateStringOf(date, timezone), 1);
  return new Date(startOfClinicDay(next, timezone).getTime() - 1);
}

/** Weekday names, index 0 = Sunday (spec §6.9). */
export const WEEKDAY_NAMES = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const);

/**
 * A calendar date ('YYYY-MM-DD', no time of day) as a `Date` at UTC midnight. Used for
 * date-only fields such as schedule `effectiveFrom` / `effectiveTo`, which mean a clinic
 * calendar day rather than an instant.
 */
export function calendarDate(date: string): Date {
  if (!isValidDateOnly(date)) throw new RangeError(`Not a valid date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

/** Inverse of `calendarDate`: a UTC-midnight `Date` → 'YYYY-MM-DD'. */
export function calendarDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a 'YYYY-MM-DD' calendar date. */
export function weekdayOf(date: string): number {
  return calendarDate(date).getUTCDay();
}

/** 'YYYY-MM-DD' shifted back by `years` calendar years (29 Feb → 28 Feb in a common year). */
export function subtractYears(date: string, years: number): string {
  return format(subYears(parseISO(date), years), 'yyyy-MM-dd');
}

/**
 * Age in whole years on `today` ('YYYY-MM-DD', the clinic date) of someone born on `dateOfBirth`
 * (a calendar date at UTC midnight, or 'YYYY-MM-DD'). A 29 Feb birthday counts from 1 Mar in
 * common years.
 */
export function ageOn(dateOfBirth: Date | string, today: string): number {
  const dob = typeof dateOfBirth === 'string' ? dateOfBirth : calendarDateString(dateOfBirth);
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  return today.slice(5) < dob.slice(5) ? years - 1 : years;
}

/**
 * True for a real 'YYYY-MM-DD' date that is not after today and at most 120 years ago. "Today"
 * is the latest calendar date anywhere (UTC + 14 h), so a baby born today in the clinic
 * timezone is never rejected.
 */
export function isValidDateOfBirth(value: string, now = new Date()): boolean {
  if (!isValidDateOnly(value)) return false;
  const latestToday = new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10);
  const earliestToday = new Date(now.getTime() - 12 * 3_600_000).toISOString().slice(0, 10);
  return value <= latestToday && value >= subtractYears(earliestToday, PATIENT_RULES.maxAgeYears);
}
