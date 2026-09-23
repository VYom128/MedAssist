import { Types } from 'mongoose';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { createDoctor, loginAsDoctor } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const TZ = 'Asia/Kolkata';
let admin: LoggedIn;
let doctorId: string;
let today: string;
const day = (offset: number) => addDaysToDate(today, offset);

const post = (body: object, auth = admin.auth, id = doctorId) =>
  api().post(`/api/v1/doctors/${id}/leaves`).set(auth).send(body);

describe('/doctors/:id/leaves', () => {
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs('admin');
    doctorId = (await createDoctor()).id;
    today = clinicToday(TZ);
  });

  describe('POST', () => {
    it('converts a full day with the clinic timezone (end exclusive) and audits it', async () => {
      const date = day(7);
      const res = await post({ date, fullDay: true, type: 'leave', reason: 'Family function' });
      expect(res.status).toBe(201);
      expect(res.body.data.affectedAppointments).toEqual([]);
      // Midnight in India is 18:30 UTC the day before.
      expect(res.body.data.leave).toMatchObject({
        doctorId,
        startAt: `${day(6)}T18:30:00.000Z`,
        endAt: `${day(7)}T18:30:00.000Z`,
        type: 'leave',
        reason: 'Family function',
        isCancelled: false,
      });
      const [entry] = await auditEntries('doctor.leave_create');
      expect(entry).toMatchObject({
        resource: { type: 'doctor_leave' },
        metadata: { doctor: doctorId },
      });
    });

    it('several whole days with endDate (inclusive)', async () => {
      const res = await post({
        date: day(20),
        endDate: day(22),
        fullDay: true,
        type: 'conference',
      });
      expect(res.body.data.leave).toMatchObject({
        startAt: `${day(19)}T18:30:00.000Z`,
        endAt: `${day(22)}T18:30:00.000Z`,
        type: 'conference',
      });
    });

    it('accepts a part-day leave as UTC instants', async () => {
      const res = await post({
        startAt: `${day(3)}T08:30:00.000Z`,
        endAt: `${day(3)}T12:30:00Z`,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.leave).toMatchObject({ type: 'leave', reason: null });
    });

    it('409 for overlapping non-cancelled leave; back-to-back is fine', async () => {
      const first = await post({ date: day(7), fullDay: true });
      const overlap = await post({ startAt: `${day(7)}T05:00:00Z`, endAt: `${day(7)}T06:00:00Z` });
      expect(expectErrorShape(overlap.body, 'CONFLICT').error.details).toMatchObject({
        leaveId: first.body.data.leave.id,
      });
      expect((await post({ date: day(8), fullDay: true })).status).toBe(201); // touches, no overlap

      // A cancelled leave no longer blocks.
      await api()
        .post(`/api/v1/doctors/${doctorId}/leaves/${first.body.data.leave.id}/cancel`)
        .set(admin.auth);
      expect((await post({ date: day(7), fullDay: true })).status).toBe(201);
    });

    it('two overlapping requests at once: exactly one succeeds', async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => post({ date: day(9), fullDay: true })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      expect(await DoctorLeave.countDocuments({ doctor: doctorId })).toBe(1);
    });

    it('422 for past leave, end before start, or too long', async () => {
      const past = await post({ date: day(-1), fullDay: true });
      expect(expectErrorShape(past.body, 'BUSINESS_RULE_VIOLATION').error.details).toEqual([
        { field: 'body.date', message: 'Leave cannot be in the past' },
      ]);
      expect((await post({ date: today, fullDay: true })).status).toBe(201); // today is allowed

      const backwards = await post({
        startAt: `${day(3)}T10:00:00Z`,
        endAt: `${day(3)}T09:00:00Z`,
      });
      expectErrorShape(backwards.body, 'BUSINESS_RULE_VIOLATION');
      const long = await post({ date: day(1), endDate: day(100), fullDay: true });
      expectErrorShape(long.body, 'BUSINESS_RULE_VIOLATION');
    });

    it.each([
      [{ date: '2026-13-01', fullDay: true }, 'body.date'],
      [{ date: '2030-01-10' }, 'body.fullDay'],
      [{ date: '2030-01-10', fullDay: false }, 'body.fullDay'],
      [{ date: '2030-01-10', endDate: '2030-01-09', fullDay: true }, 'body.endDate'],
      [{ startAt: '2030-01-10T10:00:00Z' }, 'body.endAt'],
      [{ startAt: 'tomorrow', endAt: '2030-01-10T10:00:00Z' }, 'body.startAt'],
      [
        {
          startAt: '2030-01-10T10:00:00Z',
          endAt: '2030-01-10T11:00:00Z',
          date: '2030-01-10',
          fullDay: true,
        },
        'body',
      ],
      [{ date: '2030-01-10', fullDay: true, type: 'holiday' }, 'body.type'],
      [{}, 'body.startAt'],
    ])('400 for %j', async (body, field) => {
      const res = await post(body);
      const details = expectErrorShape(res.body, 'VALIDATION_ERROR').error.details as {
        field: string;
      }[];
      expect(details.map((d) => d.field)).toContain(field);
    });
  });

  describe('GET', () => {
    it('lists upcoming leave by default; from/to and includeCancelled filter', async () => {
      await DoctorLeave.create({
        doctor: doctorId,
        startAt: new Date(Date.now() - 10 * 86_400_000),
        endAt: new Date(Date.now() - 9 * 86_400_000),
      });
      const a = await post({ date: day(5), fullDay: true });
      await post({ date: day(30), fullDay: true });
      await api()
        .post(`/api/v1/doctors/${doctorId}/leaves/${a.body.data.leave.id}/cancel`)
        .set(admin.auth);

      const url = `/api/v1/doctors/${doctorId}/leaves`;
      const upcoming = await api().get(url).set(admin.auth);
      expect(upcoming.body.data).toHaveLength(1);
      expect(upcoming.body.meta).toMatchObject({ total: 1 });

      const withCancelled = await api().get(`${url}?includeCancelled=true`).set(admin.auth);
      expect(withCancelled.body.data.map((l: { isCancelled: boolean }) => l.isCancelled)).toEqual([
        true,
        false,
      ]);

      const window = await api()
        .get(`${url}?from=${day(-15)}&to=${day(10)}`)
        .set(admin.auth);
      expect(window.body.data).toHaveLength(1); // the past one; day 5 is cancelled, day 30 outside
      expect(
        (
          await api()
            .get(`${url}?from=${day(5)}&to=${day(1)}`)
            .set(admin.auth)
        ).status,
      ).toBe(400);
    });
  });

  describe('cancel', () => {
    it('cancels once (audited); again → 409; wrong doctor → 404', async () => {
      const created = await post({ date: day(7), fullDay: true });
      const id = created.body.data.leave.id as string;
      const url = `/api/v1/doctors/${doctorId}/leaves/${id}/cancel`;
      const res = await api().post(url).set(admin.auth);
      expect(res.body.data).toMatchObject({ isCancelled: true, cancelledAt: expect.any(String) });
      expectErrorShape((await api().post(url).set(admin.auth)).body, 'INVALID_STATUS_TRANSITION');
      expect(await auditEntries('doctor.leave_cancel')).toHaveLength(1);

      const other = await createDoctor();
      const wrong = await api()
        .post(`/api/v1/doctors/${other.id}/leaves/${id}/cancel`)
        .set(admin.auth);
      expect(wrong.status).toBe(404);
      const missing = await api()
        .post(`/api/v1/doctors/${doctorId}/leaves/${new Types.ObjectId()}/cancel`)
        .set(admin.auth);
      expect(missing.status).toBe(404);
    });

    it('leave that has ended cannot be cancelled', async () => {
      const past = await DoctorLeave.create({
        doctor: doctorId,
        startAt: new Date(Date.now() - 3 * 86_400_000),
        endAt: new Date(Date.now() - 2 * 86_400_000),
      });
      const res = await api()
        .post(`/api/v1/doctors/${doctorId}/leaves/${past._id}/cancel`)
        .set(admin.auth);
      expectErrorShape(res.body, 'BUSINESS_RULE_VIOLATION');
    });
  });

  describe('who may read and write', () => {
    it('a doctor manages only their own leave; receptionists read any', async () => {
      const dr = await loginAsDoctor();
      const own = await post({ date: day(4), fullDay: true }, dr.auth, dr.id);
      expect(own.status).toBe(201);
      expect(
        (
          await api()
            .post(`/api/v1/doctors/${dr.id}/leaves/${own.body.data.leave.id}/cancel`)
            .set(dr.auth)
        ).status,
      ).toBe(200);
      expectErrorShape(
        (await post({ date: day(4), fullDay: true }, dr.auth, doctorId)).body,
        'FORBIDDEN',
      );
      expect((await api().get(`/api/v1/doctors/${doctorId}/leaves`).set(dr.auth)).status).toBe(403);

      const reception = await loginAs('receptionist');
      expect(
        (await api().get(`/api/v1/doctors/${doctorId}/leaves`).set(reception.auth)).status,
      ).toBe(200);
      expect((await post({ date: day(4), fullDay: true }, reception.auth)).status).toBe(403);
    });
  });
});
