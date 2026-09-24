import { config } from '../src/config/env.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { addDaysToDate, clinicToday, zonedDateTimeToUtc } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createDoctor,
  createPatient,
  createSchedule,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** /queue (spec §4.6, §7.9, §8.4). The clinic is at about midday. */

let tz: string;
let today: string;
let reception: LoggedIn;
let doctor: LoggedIn & { id: string };
const clinicAt = (time: string, date = today) => zonedDateTimeToUtc(date, time, tz);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

let token = 0;
/** A checked-in (by default) appointment of a new patient with `doctorId`. */
async function queued(
  time: string,
  over: Record<string, unknown> & { checkedInMinutesAgo?: number; doctorId?: string } = {},
) {
  const { checkedInMinutesAgo = 10, doctorId = doctor.id, ...rest } = over;
  token += 1;
  const patient = await createPatient({ firstName: 'Zelda', lastName: `Quinn${token}` });
  return insertAppointment({
    patient: patient.id,
    doctor: doctorId,
    startAt: clinicAt(time),
    status: 'checked_in',
    queue: { tokenNumber: token, checkedInAt: minutesAgo(checkedInMinutesAgo) },
    ...rest,
  });
}

const getQueue = (query = '', auth = doctor.auth) => api().get(`/api/v1/queue${query}`).set(auth);
const callNext = (auth = doctor.auth) => api().post('/api/v1/queue/call-next').set(auth).send({});

describe('/queue', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    token = 0;
    tz = await useMiddayClinicZone();
    today = clinicToday(tz);
    reception = await loginAs('receptionist');
    doctor = await loginAsDoctor({ roomNumber: '12B' });
    await createSchedule(doctor.id, [{ start: '09:00', end: '16:00' }]);
  });
  afterEach(() => emails.restore());

  describe('GET /queue', () => {
    it('splits waiting / in consultation / done and orders the waiting list', async () => {
      const normal930 = await queued('09:30');
      const normal900 = await queued('09:00', { checkedInMinutesAgo: 5 });
      const emergency = await queued('11:00', { priority: 'emergency' });
      const walkIn = await queued('11:45', { type: 'walk_in', checkedInMinutesAgo: 40 });
      const withDoctor = await queued('08:45', {
        status: 'in_consultation',
        queue: { tokenNumber: 90, checkedInAt: minutesAgo(50), startedAt: minutesAgo(5) },
      });
      const done = await queued('08:30', {
        status: 'completed',
        queue: {
          tokenNumber: 91,
          checkedInAt: minutesAgo(90),
          startedAt: minutesAgo(80),
          completedAt: minutesAgo(60),
        },
      });
      await queued('10:00', { status: 'scheduled' }); // not arrived: not in the queue
      await queued('10:15', { status: 'cancelled' });

      const res = await getQueue();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const q = res.body.data;
      expect(q.doctor).toEqual({ id: doctor.id, name: expect.any(String), roomNumber: '12B' });
      expect(q.date).toBe(today);
      // The walk-in counts from its check-in (~40 min ago, i.e. after 11:20 clinic time), so it
      // comes after the 09:00 and 09:30 bookings.
      const order = q.waiting.map((w: { appointmentId: string }) => w.appointmentId);
      expect(order[0]).toBe(emergency._id.toString());
      expect(order.slice(1, 3)).toEqual([normal900._id.toString(), normal930._id.toString()]);
      expect(order[3]).toBe(walkIn._id.toString());
      expect(q.inConsultation.map((w: { appointmentId: string }) => w.appointmentId)).toEqual([
        withDoctor._id.toString(),
      ]);
      expect(q.done.map((w: { appointmentId: string }) => w.appointmentId)).toEqual([
        done._id.toString(),
      ]);
      expect(q.waiting[0]).toMatchObject({
        tokenNumber: expect.any(Number),
        status: 'checked_in',
        patient: { shortName: expect.stringMatching(/^Zelda Q\.$/), mrn: expect.any(String) },
        priority: 'emergency',
        type: 'new',
        position: 1,
        waitMinutes: 10,
      });
      expect(q.done[0].waitMinutes).toBe(10); // checked in → started
    });

    it('estimated wait = patients ahead (incl. the one with the doctor) × average consultation', async () => {
      // History: two consultations of 20 and 30 minutes in the last 30 days → average 25.
      for (const [days, minutes] of [
        [3, 20],
        [10, 30],
      ] as const) {
        const startedAt = new Date(Date.now() - days * 86_400_000);
        await queued('08:00', {
          startAt: startedAt,
          status: 'completed',
          queue: { startedAt, completedAt: new Date(startedAt.getTime() + minutes * 60_000) },
        });
      }
      // Older than 30 days: ignored.
      const old = new Date(Date.now() - 40 * 86_400_000);
      await queued('08:00', {
        startAt: old,
        status: 'completed',
        queue: { startedAt: old, completedAt: new Date(old.getTime() + 120 * 60_000) },
      });
      await queued('09:00', { status: 'in_consultation', queue: { startedAt: minutesAgo(2) } });
      await queued('09:15');
      await queued('09:30');

      const q = (await getQueue()).body.data;
      expect(q).toMatchObject({ averageConsultMinutes: 25, averageBasis: 'history' });
      expect(
        q.waiting.map((w: { estimatedWaitMinutes: number }) => w.estimatedWaitMinutes),
      ).toEqual([25, 50]);
    });

    it('without history the slot length is the average', async () => {
      await DoctorProfile.updateOne({ user: doctor.id }, { $set: { slotMinutes: 20 } });
      await queued('09:15');
      await queued('09:30');
      const q = (await getQueue()).body.data;
      expect(q).toMatchObject({ averageConsultMinutes: 20, averageBasis: 'slot' });
      expect(
        q.waiting.map((w: { estimatedWaitMinutes: number }) => w.estimatedWaitMinutes),
      ).toEqual([0, 20]);
    });

    it('reception names the doctor; another day with ?date', async () => {
      await queued('09:15');
      expect((await getQueue('', reception.auth)).status).toBe(400);
      const res = await getQueue(`?doctor=${doctor.id}`, reception.auth);
      expect(res.body.data.waiting).toHaveLength(1);
      const tomorrow = await getQueue(
        `?doctor=${doctor.id}&date=${addDaysToDate(today, 1)}`,
        reception.auth,
      );
      expect(tomorrow.body.data.waiting).toEqual([]);
    });

    it('a doctor sees only their own queue (403); patients and lab techs none', async () => {
      const other = await createDoctor();
      expect((await getQueue(`?doctor=${other.id}`)).status).toBe(403);
      expect((await getQueue('', (await loginAsPatient()).auth)).status).toBe(403);
      expect((await getQueue('', (await loginAs('labtech')).auth)).status).toBe(403);
    });
  });

  describe('POST /queue/call-next', () => {
    it('nobody waiting → 200 with data null', async () => {
      const res = await callNext();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ data: null, message: 'Nobody is waiting' });
    });

    it('calls the first in queue order (emergency first) and audits via call_next', async () => {
      await queued('09:00');
      const emergency = await queued('11:30', { priority: 'emergency' });
      const res = await callNext();
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: emergency._id.toString(),
        status: 'in_consultation',
        queue: { calledAt: expect.any(String), startedAt: expect.any(String) },
      });
      expect(await auditEntries('appointment.start')).toEqual([
        expect.objectContaining({ metadata: expect.objectContaining({ via: 'call_next' }) }),
      ]);
    });

    it('while a patient is in consultation → 409 with a clear message', async () => {
      await queued('09:00');
      expect((await callNext()).status).toBe(200);
      const res = await callNext();
      expect(res.status).toBe(409);
      expect(expectErrorShape(res.body, 'CONFLICT').message).toMatch(
        /already have a patient in consultation/,
      );
    });

    it("only the calling doctor's patients, only today", async () => {
      const other = await createDoctor();
      await queued('09:00', { doctorId: other.id });
      await queued('09:00', { startAt: clinicAt('09:00', addDaysToDate(today, -1)) });
      expect((await callNext()).body.data).toBeNull();
    });

    it('parallel call-next clicks start one patient', async () => {
      await queued('09:00');
      await queued('09:15');
      const results = await Promise.all([callNext(), callNext(), callNext()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await Appointment.countDocuments({ status: 'in_consultation' })).toBe(1);
    });

    it('only doctors', async () => {
      expect((await callNext(reception.auth)).status).toBe(403);
    });
  });

  describe('POST /queue/:appointmentId/priority', () => {
    const setPriority = (id: string, body: object, auth = reception.auth) =>
      api().post(`/api/v1/queue/${id}/priority`).set(auth).send(body);

    it('re-prioritises a waiting patient, records why, audits, and reorders', async () => {
      await queued('09:00');
      const later = await queued('11:00');
      const res = await setPriority(later._id.toString(), {
        priority: 'emergency',
        reason: 'Breathing difficulty',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        priority: 'emergency',
        priorityHistory: [
          expect.objectContaining({
            from: 'normal',
            to: 'emergency',
            reason: 'Breathing difficulty',
          }),
        ],
      });
      const [entry] = await auditEntries('appointment.priority_change');
      expect(entry).toMatchObject({
        changes: { before: { priority: 'normal' }, after: { priority: 'emergency' } },
        metadata: { reasonGiven: true },
      });
      expect(JSON.stringify(entry)).not.toContain('Breathing');
      const q = (await getQueue()).body.data;
      expect(q.waiting[0].appointmentId).toBe(later._id.toString());
    });

    it('needs a reason; only while waiting; not the same priority', async () => {
      const waiting = await queued('09:00');
      expect((await setPriority(waiting._id.toString(), { priority: 'priority' })).status).toBe(
        400,
      );
      expect(
        (await setPriority(waiting._id.toString(), { priority: 'normal', reason: 'Same' })).status,
      ).toBe(422);
      const scheduled = await queued('10:00', { status: 'scheduled' });
      expect(
        (await setPriority(scheduled._id.toString(), { priority: 'priority', reason: 'Elderly' }))
          .status,
      ).toBe(422);
    });

    it('only receptionists', async () => {
      const waiting = await queued('09:00');
      const res = await setPriority(
        waiting._id.toString(),
        { priority: 'priority', reason: 'Elderly' },
        doctor.auth,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('GET /queue/my-position', () => {
    it("the patient's token, position, patients ahead and estimated wait", async () => {
      const me = await loginAsPatient();
      await queued('09:00', { status: 'in_consultation', queue: { startedAt: minutesAgo(3) } });
      await queued('09:15');
      const mine = await insertAppointment({
        patient: me.patientId,
        doctor: doctor.id,
        startAt: clinicAt('09:30'),
        status: 'checked_in',
        queue: { tokenNumber: 42, checkedInAt: minutesAgo(1) },
      });
      const res = await api().get('/api/v1/queue/my-position').set(me.auth);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        appointmentId: mine._id.toString(),
        appointmentNumber: mine.appointmentNumber,
        tokenNumber: 42,
        status: 'checked_in',
        position: 2,
        patientsAhead: 2,
        estimatedWaitMinutes: 30, // 2 ahead × 15-min slots (no history)
        doctor: { id: doctor.id, name: expect.any(String), roomNumber: '12B' },
        checkedInAt: expect.any(String),
      });
    });

    it('with the doctor now → position 0; not checked in → null', async () => {
      const me = await loginAsPatient();
      expect((await api().get('/api/v1/queue/my-position').set(me.auth)).body.data).toBeNull();
      await insertAppointment({
        patient: me.patientId,
        doctor: doctor.id,
        startAt: clinicAt('09:30'),
        status: 'in_consultation',
        queue: { tokenNumber: 5, startedAt: minutesAgo(1) },
      });
      const res = await api().get('/api/v1/queue/my-position').set(me.auth);
      expect(res.body.data).toMatchObject({
        status: 'in_consultation',
        position: 0,
        patientsAhead: 0,
      });
    });

    it('patients only', async () => {
      expect((await api().get('/api/v1/queue/my-position').set(reception.auth)).status).toBe(403);
    });
  });

  describe('GET /queue/board', () => {
    const board = (key?: string) =>
      api().get(`/api/v1/queue/board${key === undefined ? '' : `?key=${encodeURIComponent(key)}`}`);

    it('tokens, doctor name and room only – no patient names, MRNs or ids', async () => {
      await queued('09:00', {
        status: 'in_consultation',
        queue: { tokenNumber: 7, startedAt: minutesAgo(2) },
      });
      for (let i = 0; i < 7; i += 1) await queued(`09:${String(15 + i * 5).padStart(2, '0')}`);
      const res = await board(config.kiosk.key);
      expect(res.status).toBe(200);
      expect(res.body.data.date).toBe(today);
      expect(res.body.data.doctors).toEqual([
        {
          doctorName: expect.any(String),
          roomNumber: '12B',
          nowServing: 7,
          next: expect.any(Array),
          waitingCount: 7,
        },
      ]);
      expect(res.body.data.doctors[0].next).toHaveLength(5);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/Zelda|Quinn|MRN-|[a-f0-9]{24}|patient/i);
    });

    it('a wrong or missing key → 401; no login needed', async () => {
      expectErrorShape((await board('wrong-key-wrong-key-wrong-key')).body, 'UNAUTHORIZED');
      expect((await board()).status).toBe(401);
      expect((await board('')).status).toBe(401);
    });
  });
});
