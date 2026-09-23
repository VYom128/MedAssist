import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { getScheduleForDate } from '../src/modules/schedules/service.js';
import { ClinicSettings } from '../src/modules/settings/model.js';
import { clearSettingsCache } from '../src/modules/settings/service.js';
import { addDaysToDate, calendarDate, clinicToday, weekdayOf } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { createDoctor, loginAsDoctor } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const TZ = 'Asia/Kolkata';
let admin: LoggedIn;
let doctorId: string;
let today: string;

const WEEK = [
  {
    weekday: 1,
    sessions: [
      { start: '09:00', end: '13:00' },
      { start: '17:00', end: '20:00' },
    ],
  },
  { weekday: 3, sessions: [{ start: '09:00', end: '13:00' }] },
  { weekday: 6, sessions: [{ start: '09:00', end: '12:00', maxWalkIns: 4 }] },
];

const put = (body: object, auth = admin.auth, id = doctorId) =>
  api().put(`/api/v1/doctors/${id}/schedule`).set(auth).send(body);

describe('/doctors/:id/schedule', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
    doctorId = (await createDoctor()).id;
    today = clinicToday(TZ);
  });

  describe('PUT', () => {
    it('saves a weekly template (7 days, missing = off) and audits it', async () => {
      const res = await put({ effectiveFrom: today, days: WEEK });
      expect(res.status).toBe(200);
      expect(res.body.data.affectedAppointments).toEqual([]);
      expect(res.body.data.warnings).toEqual([]);
      const current = res.body.data.current;
      expect(current).toMatchObject({ effectiveFrom: today, effectiveTo: null });
      expect(current.days).toHaveLength(7);
      expect(current.days[0]).toEqual({ weekday: 0, sessions: [] });
      expect(current.days[1].sessions).toEqual([
        { start: '09:00', end: '13:00', maxWalkIns: 2 }, // clinic default walkInOverbookPerSession
        { start: '17:00', end: '20:00', maxWalkIns: 2 },
      ]);
      expect(current.days[6].sessions[0].maxWalkIns).toBe(4);
      expect(res.body.data.upcoming).toBeNull();
      expect(await DoctorSchedule.countDocuments({ doctor: doctorId })).toBe(7);

      const [entry] = await auditEntries('doctor.schedule_update');
      expect(entry).toMatchObject({
        resource: { type: 'doctor', id: expect.anything() },
        changes: { fields: ['schedule'], before: { schedule: null } },
        metadata: { effectiveFrom: today },
      });
    });

    it('stores sessions sorted by start time', async () => {
      const res = await put({
        effectiveFrom: today,
        days: [
          {
            weekday: 2,
            sessions: [
              { start: '17:00', end: '20:00' },
              { start: '09:00', end: '12:00' },
            ],
          },
        ],
      });
      expect(res.body.data.current.days[2].sessions.map((s: { start: string }) => s.start)).toEqual(
        ['09:00', '17:00'],
      );
    });

    it('versioning: a later version closes the current one the day before', async () => {
      await put({ effectiveFrom: today, days: WEEK });
      const next = addDaysToDate(today, 7);
      const res = await put({
        effectiveFrom: next,
        days: [{ weekday: 2, sessions: [{ start: '10:00', end: '14:00' }] }],
      });
      expect(res.body.data.current).toMatchObject({
        effectiveFrom: today,
        effectiveTo: addDaysToDate(today, 6),
      });
      expect(res.body.data.upcoming).toMatchObject({ effectiveFrom: next, effectiveTo: null });

      // GET shows the same
      const get = await api().get(`/api/v1/doctors/${doctorId}/schedule`).set(admin.auth);
      expect(get.body.data.current.effectiveTo).toBe(addDaysToDate(today, 6));
      expect(get.body.data.upcoming.effectiveFrom).toBe(next);

      // An earlier new version replaces the future one (it never took effect).
      const mid = addDaysToDate(today, 3);
      const again = await put({ effectiveFrom: mid, days: WEEK });
      expect(again.body.data.current.effectiveTo).toBe(addDaysToDate(today, 2));
      expect(again.body.data.upcoming).toMatchObject({ effectiveFrom: mid, effectiveTo: null });
      expect(await DoctorSchedule.countDocuments({ doctor: doctorId })).toBe(14);
      expect(
        await DoctorSchedule.countDocuments({
          doctor: doctorId,
          effectiveFrom: calendarDate(next),
        }),
      ).toBe(0);

      const audits = await auditEntries('doctor.schedule_update');
      expect(audits).toHaveLength(3);
      expect(audits[1]?.changes?.before).toMatchObject({ schedule: { effectiveFrom: today } });
    });

    it('saving again from the same date replaces that version', async () => {
      await put({ effectiveFrom: today, days: WEEK });
      const res = await put({ effectiveFrom: today, days: [] });
      expect(
        res.body.data.current.days.every((d: { sessions: unknown[] }) => d.sessions.length === 0),
      ).toBe(true);
      expect(await DoctorSchedule.countDocuments({ doctor: doctorId })).toBe(7);
    });

    it('warns (does not block) about sessions on non-working days', async () => {
      await ClinicSettings.updateOne(
        {},
        { $set: { workingDays: [1, 2, 3, 4, 5] } },
        { upsert: true },
      );
      clearSettingsCache();
      const res = await put({
        effectiveFrom: today,
        days: [
          { weekday: 0, sessions: [{ start: '09:00', end: '12:00' }] },
          { weekday: 6, sessions: [] },
          { weekday: 1, sessions: [{ start: '09:00', end: '12:00' }] },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Schedule saved with warnings');
      expect(res.body.data.warnings).toEqual([
        { weekday: 0, message: 'Sunday is not a clinic working day' },
      ]);
    });

    it('422 when effectiveFrom is in the past', async () => {
      const res = await put({ effectiveFrom: addDaysToDate(today, -1), days: WEEK });
      expect(expectErrorShape(res.body, 'BUSINESS_RULE_VIOLATION').error.details).toEqual([
        { field: 'body.effectiveFrom', message: `Must be ${today} or later` },
      ]);
    });

    it.each([
      [
        [
          {
            weekday: 1,
            sessions: [
              { start: '09:00', end: '13:00' },
              { start: '12:30', end: '14:00' },
            ],
          },
        ],
        'body.days.0.sessions.1.start',
      ],
      [
        [{ weekday: 1, sessions: [{ start: '13:00', end: '09:00' }] }],
        'body.days.0.sessions.0.end',
      ],
      [
        [{ weekday: 1, sessions: [{ start: '09:07', end: '13:00' }] }],
        'body.days.0.sessions.0.start',
      ],
      [
        [{ weekday: 1, sessions: [{ start: '9:00', end: '13:00' }] }],
        'body.days.0.sessions.0.start',
      ],
      [[{ weekday: 7, sessions: [] }], 'body.days.0.weekday'],
      [
        [
          { weekday: 1, sessions: [] },
          { weekday: 1, sessions: [] },
        ],
        'body.days.1.weekday',
      ],
    ])('400 for invalid days (%#)', async (days, field) => {
      const res = await put({ effectiveFrom: today, days });
      const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
        field: string;
      }[];
      expect(details.map((d) => d.field)).toContain(field);
    });

    it('400 for a malformed date; 404 for an unknown doctor', async () => {
      expect((await put({ effectiveFrom: '2026-02-30', days: [] })).status).toBe(400);
      const noProfile = await loginAs('doctor');
      expect(
        (await put({ effectiveFrom: today, days: [] }, admin.auth, noProfile.user._id.toString()))
          .status,
      ).toBe(404);
    });
  });

  describe('who may read and write', () => {
    it('a doctor edits their own schedule but not another doctor’s', async () => {
      const dr = await loginAsDoctor();
      expect((await put({ effectiveFrom: today, days: WEEK }, dr.auth, dr.id)).status).toBe(200);
      const other = await put({ effectiveFrom: today, days: WEEK }, dr.auth, doctorId);
      expectErrorShape(other.body, 'FORBIDDEN');
      expect((await api().get(`/api/v1/doctors/${doctorId}/schedule`).set(dr.auth)).status).toBe(
        403,
      );
      expect((await api().get(`/api/v1/doctors/${dr.id}/schedule`).set(dr.auth)).status).toBe(200);
    });

    it('receptionists read any schedule but cannot change it; patients and lab techs cannot read', async () => {
      const reception = await loginAs('receptionist');
      expect(
        (await api().get(`/api/v1/doctors/${doctorId}/schedule`).set(reception.auth)).status,
      ).toBe(200);
      expect((await put({ effectiveFrom: today, days: WEEK }, reception.auth)).status).toBe(403);
      for (const role of ['patient', 'labtech'] as const) {
        const u = await loginAs(role);
        expect((await api().get(`/api/v1/doctors/${doctorId}/schedule`).set(u.auth)).status).toBe(
          403,
        );
      }
    });
  });

  describe('getScheduleForDate (Phase 4 helper)', () => {
    it('picks the version in effect on the date and that weekday’s sessions', async () => {
      const d = (offset: number) => addDaysToDate(today, offset);
      // v1 from today: every weekday 09:00–13:00; v2 from today+10: every weekday 17:00–20:00
      const every = (start: string, end: string) =>
        Array.from({ length: 7 }, (_, weekday) => ({ weekday, sessions: [{ start, end }] }));
      await put({ effectiveFrom: d(0), days: every('09:00', '13:00') });
      await put({ effectiveFrom: d(10), days: every('17:00', '20:00') });

      expect(await getScheduleForDate(doctorId, d(-1))).toBeNull();
      expect(await getScheduleForDate(doctorId, d(0))).toMatchObject({
        effectiveFrom: d(0),
        effectiveTo: d(9),
        weekday: weekdayOf(d(0)),
        sessions: [{ start: '09:00', end: '13:00' }],
      });
      expect((await getScheduleForDate(doctorId, d(9)))?.sessions[0]?.start).toBe('09:00');
      expect(await getScheduleForDate(doctorId, d(10))).toMatchObject({
        effectiveFrom: d(10),
        effectiveTo: null,
        sessions: [{ start: '17:00', end: '20:00' }],
      });
      expect((await getScheduleForDate(doctorId, d(400)))?.sessions[0]?.start).toBe('17:00');
    });

    it('a day off in a version returns empty sessions (not null)', async () => {
      await put({ effectiveFrom: today, days: [] });
      expect(await getScheduleForDate(doctorId, today)).toMatchObject({ sessions: [] });
    });
  });
});
