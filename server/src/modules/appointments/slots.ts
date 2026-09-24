import { APPOINTMENT_RULES } from '../../config/constants.js';
import {
  minutesToTime,
  timeToMinutes,
  toClinicTime,
  zonedDateTimeToUtc,
} from '../../utils/dates.js';

/**
 * Slot engine (spec §8.1): pure functions, no I/O. The service loads the schedule, leave and
 * bookings and passes them in, so the rules can be tested without a database.
 */

/** A half-open time range `[startAt, endAt)` in UTC. */
export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

export interface Slot extends TimeRange {
  /** Clinic wall-clock start time, 'HH:mm'. */
  label: string;
}

export interface GenerateSlotsInput {
  /** Clinic date 'YYYY-MM-DD'. */
  date: string;
  /** The day's sessions (`getScheduleForDate`); null or no sessions = not working. */
  schedule: { sessions: readonly { start: string; end: string }[] } | null;
  /** Grid step: the doctor's slot length, else the clinic default. */
  slotMinutes: number;
  /** Length of the service being booked (default: one slot). */
  serviceMinutes?: number;
  /** The doctor's non-cancelled leave. */
  leaves?: readonly TimeRange[];
  /** Appointments holding a slot (`isSlotActive: true`). */
  booked?: readonly TimeRange[];
  now: Date;
  timezone: string;
  /** Slots starting sooner than this after `now` are not offered (default 15). */
  minLeadMinutes?: number;
}

const MINUTE = 60_000;

/** Half-open ranges overlap: `a.start < b.end && a.end > b.start` (touching is fine). */
export const overlaps = (a: TimeRange, b: TimeRange) => a.startAt < b.endAt && a.endAt > b.startAt;

/**
 * The slot grid of a day, before removing leave, bookings or the lead time: for each session,
 * a start every `slotMinutes` from the session start, where a `serviceMinutes`-long appointment
 * still ends by the session end (so longer services need consecutive time). Clock times are
 * clinic wall-clock times converted with the clinic timezone; a wall time that does not exist
 * (skipped by a daylight-saving change) is not offered.
 */
export function slotGrid({
  date,
  schedule,
  slotMinutes,
  serviceMinutes = slotMinutes,
  timezone,
}: Pick<
  GenerateSlotsInput,
  'date' | 'schedule' | 'slotMinutes' | 'serviceMinutes' | 'timezone'
>): Slot[] {
  if (!schedule || slotMinutes <= 0 || serviceMinutes <= 0) return [];
  const slots: Slot[] = [];
  for (const session of schedule.sessions) {
    const sessionEnd = zonedDateTimeToUtc(date, session.end, timezone);
    const endMinutes = timeToMinutes(session.end);
    for (let m = timeToMinutes(session.start); m < endMinutes; m += slotMinutes) {
      const label = minutesToTime(m);
      const startAt = zonedDateTimeToUtc(date, label, timezone);
      if (toClinicTime(startAt, timezone) !== label) continue; // in a DST gap
      const endAt = new Date(startAt.getTime() + serviceMinutes * MINUTE);
      if (endAt > sessionEnd) break;
      slots.push({ startAt, endAt, label });
    }
  }
  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Free slots for a doctor on a clinic date (spec §8.1 steps 3–7): the grid minus slots that
 * overlap leave or an active appointment, and minus slots starting within `minLeadMinutes` of
 * `now` (which also removes every slot in the past).
 */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { leaves = [], booked = [], now } = input;
  const earliest =
    now.getTime() + (input.minLeadMinutes ?? APPOINTMENT_RULES.minLeadMinutes) * MINUTE;
  return slotGrid(input).filter(
    (slot) =>
      slot.startAt.getTime() >= earliest &&
      !leaves.some((l) => overlaps(slot, l)) &&
      !booked.some((b) => overlaps(slot, b)),
  );
}
