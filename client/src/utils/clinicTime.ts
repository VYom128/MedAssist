import { format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { getClinicTimezone } from './clinicTimezone';

/**
 * react-big-calendar lays events out with the browser's local time. To show clinic time whatever
 * the browser's timezone, the calendar works with "wall dates": `Date`s whose *local* fields
 * (year … minute) equal the clinic wall-clock time. Convert with these two functions at the
 * boundary and nowhere else.
 */

/** An instant → the wall date showing its clinic time (for the calendar). */
export function toClinicWallDate(instant: Date | string, timeZone = getClinicTimezone()): Date {
  return toZonedTime(instant, timeZone);
}

/** A wall date from the calendar (a clicked slot, a drop target) → the real instant. */
export function fromClinicWallDate(wall: Date, timeZone = getClinicTimezone()): Date {
  return fromZonedTime(wall, timeZone);
}

/** The clinic date 'YYYY-MM-DD' a wall date stands for. */
export const wallDateString = (wall: Date) => format(wall, 'yyyy-MM-dd');

/** Clinic wall-clock 'HH:mm' of a wall date. */
export const wallTimeString = (wall: Date) => format(wall, 'HH:mm');
