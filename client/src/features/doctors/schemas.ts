import { z } from 'zod';
import { LEAVE_TYPES, WEEK_ORDER } from '../../constants/catalog';
import { minutesOf, toUtcFromClinic } from '../../utils/dates';
import { paiseField } from '../services/schemas';
import type { DoctorProfileInput, LeaveInput, ScheduleInput } from './api';

// Mirrors server/src/modules/doctors, schedules and leaves validation.

const namePart = z.string().trim().min(1, 'Required').max(50, 'At most 50 characters');

/** Optional whole number typed in a text box: '' → null. */
const optionalInt = (min: number, max: number, unit: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+$/.test(v), `Whole ${unit}`)
    .refine((v) => v === '' || (Number(v) >= min && Number(v) <= max), `${min}–${max} ${unit}`)
    .transform((v) => (v === '' ? null : Number(v)));

const shortList = (label: string, max: number) =>
  z.array(z.string()).max(max, `At most ${max} ${label}`);

export const accountSchema = z.object({
  firstName: namePart,
  lastName: namePart,
  email: z.string().trim().min(1, 'Enter an email').pipe(z.email('Enter a valid email')),
  phone: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\+?\d{10,15}$/.test(v.replace(/[\s-]/g, '')),
      'Enter a valid phone number',
    ),
});

export const profileSchema = z.object({
  department: z.string().min(1, 'Choose a department'),
  specialization: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(100, 'At most 100 characters'),
  qualifications: shortList('qualifications', 10),
  registrationNumber: z
    .string()
    .trim()
    .min(3, 'At least 3 characters')
    .max(50, 'At most 50 characters'),
  experienceYears: optionalInt(0, 70, 'years'),
  consultationFeePaise: paiseField(false),
  slotMinutes: optionalInt(5, 120, 'minutes'),
  roomNumber: z.string().trim().max(20, 'At most 20 characters'),
  bio: z.string().trim().max(1000, 'At most 1000 characters'),
  languages: shortList('languages', 10),
});

export const addDoctorSchema = accountSchema.extend(profileSchema.shape);

export type ProfileFormInput = z.input<typeof profileSchema>;
export type ProfileFormValues = z.output<typeof profileSchema>;
export type AddDoctorFormInput = z.input<typeof addDoctorSchema>;
export type AddDoctorFormValues = z.output<typeof addDoctorSchema>;

export const ACCOUNT_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const;
export const PROFILE_FIELDS = [
  'department',
  'specialization',
  'qualifications',
  'registrationNumber',
  'experienceYears',
  'consultationFeePaise',
  'slotMinutes',
  'roomNumber',
  'bio',
  'languages',
] as const;

export const emptyProfile = (): ProfileFormInput => ({
  department: '',
  specialization: '',
  qualifications: [],
  registrationNumber: '',
  experienceYears: '',
  consultationFeePaise: null,
  slotMinutes: '',
  roomNumber: '',
  bio: '',
  languages: [],
});

export const toProfileInput = (v: ProfileFormValues): DoctorProfileInput => ({
  department: v.department,
  specialization: v.specialization,
  qualifications: v.qualifications,
  registrationNumber: v.registrationNumber,
  experienceYears: v.experienceYears,
  consultationFeePaise: v.consultationFeePaise,
  slotMinutes: v.slotMinutes,
  roomNumber: v.roomNumber,
  bio: v.bio,
  languages: v.languages,
});

/** A doctor's own profile page: only these two fields (spec §7.6). */
export const ownProfileSchema = z.object({
  bio: z.string().trim().max(1000, 'At most 1000 characters'),
  languages: shortList('languages', 10),
});
export type OwnProfileValues = z.infer<typeof ownProfileSchema>;

// ---- Weekly schedule ----------------------------------------------------------------------

const STEP = 5;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time');

/**
 * The editor's 7 rows are in WEEK_ORDER (Mon…Sun); `weekday` keeps the server's number
 * (0 = Sunday). Sessions: start < end, 5-minute steps, no overlaps within a day.
 */
export const scheduleFormSchema = z
  .object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
    days: z.array(
      z.object({
        weekday: z.number(),
        sessions: z
          .array(z.object({ start: time, end: time, maxWalkIns: z.number().optional() }))
          .max(6, 'At most 6 sessions a day'),
      }),
    ),
  })
  .superRefine((form, ctx) => {
    form.days.forEach((day, d) => {
      const valid: { start: number; end: number; i: number }[] = [];
      day.sessions.forEach((s, i) => {
        const at = (f: string) => ['days', d, 'sessions', i, f];
        if (!time.safeParse(s.start).success || !time.safeParse(s.end).success) return;
        const start = minutesOf(s.start);
        const end = minutesOf(s.end);
        let ok = true;
        for (const [f, v] of [
          ['start', start],
          ['end', end],
        ] as const) {
          if (v % STEP !== 0) {
            ctx.addIssue({ code: 'custom', path: at(f), message: 'Use 5-minute steps' });
            ok = false;
          }
        }
        if (start >= end) {
          ctx.addIssue({ code: 'custom', path: at('end'), message: 'End must be after start' });
          ok = false;
        }
        if (ok) valid.push({ start, end, i });
      });
      valid.sort((a, b) => a.start - b.start);
      for (let k = 1; k < valid.length; k += 1) {
        const prev = valid[k - 1]!;
        const cur = valid[k]!;
        if (cur.start < prev.end) {
          const other = day.sessions[prev.i]!;
          ctx.addIssue({
            code: 'custom',
            path: ['days', d, 'sessions', cur.i, 'start'],
            message: `Overlaps the ${other.start}–${other.end} session`,
          });
        }
      }
    });
  });

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

/** Editor rows (Mon…Sun) from a server version (or empty). */
export function toScheduleForm(
  effectiveFrom: string,
  version?: {
    days: { weekday: number; sessions: { start: string; end: string; maxWalkIns?: number }[] }[];
  } | null,
): ScheduleFormValues {
  return {
    effectiveFrom,
    days: WEEK_ORDER.map((weekday) => ({
      weekday,
      sessions: (version?.days.find((d) => d.weekday === weekday)?.sessions ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        ...(s.maxWalkIns !== undefined ? { maxWalkIns: s.maxWalkIns } : {}),
      })),
    })),
  };
}

/**
 * PUT body: working days only (a missing weekday is a day off), in weekday order. Sessions stay in
 * the order entered (the server sorts them), so server error paths match the editor rows.
 */
export function toScheduleInput(v: ScheduleFormValues): ScheduleInput {
  return {
    effectiveFrom: v.effectiveFrom,
    days: v.days
      .filter((d) => d.sessions.length > 0)
      .sort((a, b) => a.weekday - b.weekday)
      .map((d) => ({
        weekday: d.weekday,
        sessions: d.sessions,
      })),
  };
}

/** Total scheduled hours in a week ("preview"). */
export function weeklyHours(v: Pick<ScheduleFormValues, 'days'>): number {
  const minutes = v.days
    .flatMap((d) => d.sessions)
    .filter((s) => time.safeParse(s.start).success && time.safeParse(s.end).success)
    .reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0);
  return Math.round((minutes / 60) * 100) / 100;
}

// ---- Leave --------------------------------------------------------------------------------

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');

/** Full day(s) or a time range on one day, in clinic time. */
export const leaveFormSchema = z
  .object({
    mode: z.enum(['fullDay', 'range']),
    date,
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    type: z.enum(LEAVE_TYPES),
    reason: z.string().trim().max(500, 'At most 500 characters'),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'fullDay') {
      if (v.endDate && v.endDate < v.date) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'Must be on or after the first day',
        });
      }
      return;
    }
    for (const f of ['startTime', 'endTime'] as const) {
      if (!time.safeParse(v[f]).success) {
        ctx.addIssue({ code: 'custom', path: [f], message: 'Enter a time' });
      }
    }
    if (time.safeParse(v.startTime).success && time.safeParse(v.endTime).success) {
      if (minutesOf(v.endTime) <= minutesOf(v.startTime)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endTime'],
          message: 'Must be after the start time',
        });
      }
    }
  });

export type LeaveFormValues = z.infer<typeof leaveFormSchema>;

/** Form → API: full days go as dates (the server applies the clinic timezone); times → UTC. */
export function toLeaveInput(v: LeaveFormValues): LeaveInput {
  const extra = { type: v.type, ...(v.reason ? { reason: v.reason } : {}) };
  if (v.mode === 'fullDay') {
    return {
      date: v.date,
      ...(v.endDate && v.endDate !== v.date ? { endDate: v.endDate } : {}),
      fullDay: true,
      ...extra,
    };
  }
  return {
    startAt: toUtcFromClinic(v.date, v.startTime),
    endAt: toUtcFromClinic(v.date, v.endTime),
    ...extra,
  };
}
