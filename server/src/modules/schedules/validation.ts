import { z } from 'zod';
import { SCHEDULE_RULES } from '../../config/constants.js';
import { isValidTimeHHmm, timeToMinutes } from '../../utils/dates.js';
import { dateOnly, idParams, timeHHmm } from '../../utils/zod.js';

export interface SessionInput {
  start: string;
  end: string;
  maxWalkIns?: number;
}

export interface DayInput {
  weekday: number;
  sessions: SessionInput[];
}

export interface ScheduleIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Rules for a weekly template (spec §6.9): each weekday at most once; in each session
 * start < end, times on 5-minute steps; sessions within a day do not overlap (touching is fine:
 * 09:00–13:00 then 13:00–14:00). Paths are relative to the body (`days.0.sessions.1.end`).
 */
export function scheduleIssues(days: DayInput[]): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const seen = new Set<number>();
  days.forEach((day, d) => {
    if (seen.has(day.weekday)) {
      issues.push({ path: ['days', d, 'weekday'], message: 'Each weekday may appear only once' });
    }
    seen.add(day.weekday);

    const valid: { start: number; end: number; index: number }[] = [];
    day.sessions.forEach((s, i) => {
      // Malformed times are reported by the field schema (Zod still runs this refinement).
      if (!isValidTimeHHmm(s.start) || !isValidTimeHHmm(s.end)) return;
      const at = (field: string) => ['days', d, 'sessions', i, field];
      const start = timeToMinutes(s.start);
      const end = timeToMinutes(s.end);
      let ok = true;
      for (const [field, value] of [
        ['start', start],
        ['end', end],
      ] as const) {
        if (value % SCHEDULE_RULES.stepMinutes !== 0) {
          issues.push({
            path: at(field),
            message: `Use ${SCHEDULE_RULES.stepMinutes}-minute steps`,
          });
          ok = false;
        }
      }
      if (start >= end) {
        issues.push({ path: at('end'), message: 'End must be after start' });
        ok = false;
      }
      if (ok) valid.push({ start, end, index: i });
    });

    valid.sort((a, b) => a.start - b.start);
    for (let k = 1; k < valid.length; k += 1) {
      const prev = valid[k - 1]!;
      const cur = valid[k]!;
      if (cur.start < prev.end) {
        const other = day.sessions[prev.index]!;
        issues.push({
          path: ['days', d, 'sessions', cur.index, 'start'],
          message: `Overlaps the ${other.start}–${other.end} session`,
        });
      }
    }
  });
  return issues;
}

const session = z.strictObject({
  start: timeHHmm,
  end: timeHHmm,
  maxWalkIns: z.number().int('Whole number').min(0).max(20).optional(),
});

const day = z.strictObject({
  weekday: z
    .number()
    .int()
    .min(0, '0 (Sunday) to 6 (Saturday)')
    .max(6, '0 (Sunday) to 6 (Saturday)'),
  sessions: z
    .array(session)
    .max(
      SCHEDULE_RULES.maxSessionsPerDay,
      `At most ${SCHEDULE_RULES.maxSessionsPerDay} sessions a day`,
    ),
});

/**
 * PUT /doctors/:id/schedule – the whole weekly template from `effectiveFrom`. Weekdays left out
 * are days off.
 */
export const replaceScheduleSchema = {
  params: idParams,
  body: z
    .strictObject({ effectiveFrom: dateOnly, days: z.array(day).max(7) })
    .superRefine((body, ctx) => {
      // Skipped while `days` itself is malformed (Zod reports that).
      const days = z.array(day).safeParse(body.days);
      if (!days.success) return;
      for (const issue of scheduleIssues(days.data)) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }),
};

export const doctorScheduleSchema = { params: idParams };

export type ReplaceScheduleInput = z.infer<typeof replaceScheduleSchema.body>;
