import { calendarDateString } from '../../utils/dates.js';
/** A stored weekday document, or the plain object about to be inserted. */
interface Doc {
  weekday: number;
  sessions: readonly { start: string; end: string; maxWalkIns?: number | null }[];
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

export interface ScheduleVersion {
  effectiveFrom: string;
  effectiveTo: string | null;
  days: { weekday: number; sessions: { start: string; end: string; maxWalkIns: number }[] }[];
}

/** The 7 weekday documents of one version → `{ effectiveFrom, effectiveTo, days[0..6] }`. */
export function toVersionView(docs: Doc[]): ScheduleVersion {
  const first = docs[0]!;
  const byWeekday = new Map(docs.map((d) => [d.weekday, d]));
  return {
    effectiveFrom: calendarDateString(first.effectiveFrom),
    effectiveTo: first.effectiveTo ? calendarDateString(first.effectiveTo) : null,
    days: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      sessions: (byWeekday.get(weekday)?.sessions ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        maxWalkIns: s.maxWalkIns ?? 0,
      })),
    })),
  };
}
