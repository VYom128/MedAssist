import { APPOINTMENT_PRIORITIES, type AppointmentPriority } from '../../config/constants.js';

/**
 * Queue order (spec §4.6, §8.4) – pure, no I/O:
 * 1. priority: emergency, then priority, then normal;
 * 2. scheduled start time – walk-ins use their check-in time instead;
 * 3. check-in time;
 * 4. token number (stable order for exact ties).
 */

export interface QueueEntry {
  priority?: string | null;
  type?: string | null;
  startAt: Date;
  queue?: { checkedInAt?: Date | null; tokenNumber?: number | null } | null;
}

const rank = (priority?: string | null) => {
  const i = APPOINTMENT_PRIORITIES.indexOf((priority ?? 'normal') as AppointmentPriority);
  return i === -1 ? APPOINTMENT_PRIORITIES.length : i;
};
const time = (d?: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);

/** The time a patient counts as "scheduled" for: check-in time for walk-ins. */
export const queueTimeOf = (e: QueueEntry) =>
  e.type === 'walk_in' ? time(e.queue?.checkedInAt ?? e.startAt) : time(e.startAt);

export function compareQueue(a: QueueEntry, b: QueueEntry): number {
  return (
    rank(a.priority) - rank(b.priority) ||
    queueTimeOf(a) - queueTimeOf(b) ||
    time(a.queue?.checkedInAt) - time(b.queue?.checkedInAt) ||
    (a.queue?.tokenNumber ?? Number.MAX_SAFE_INTEGER) -
      (b.queue?.tokenNumber ?? Number.MAX_SAFE_INTEGER)
  );
}

/** A sorted copy of `entries` in queue order. */
export function orderQueue<T extends QueueEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(compareQueue);
}
