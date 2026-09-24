import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { config } from '../src/config/env.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { initSocket } from '../src/socket/index.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { clinicToday, zonedDateTimeToUtc } from '../src/utils/dates.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createDoctor,
  createPatient,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Socket.IO (spec §7.9): handshake authentication, room membership rules, and events sent after
 * the change has committed, carrying ids only.
 */

let io: Server;
let url: string;
const sockets: Socket[] = [];

function client(auth: Record<string, unknown>): Socket {
  const socket = connect(url, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}
const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
const rejected = (socket: Socket) =>
  new Promise<{ message: string; data?: { code: string } }>((resolve, reject) => {
    socket.once('connect', () => reject(new Error('connected')));
    socket.once('connect_error', (err) => resolve(err as never));
  });
const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ${event} within ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
const noEvent = (socket: Socket, event: string, ms = 300) =>
  new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error(`unexpected ${event}`));
    socket.once(event, fail);
    setTimeout(() => {
      socket.off(event, fail);
      resolve();
    }, ms);
  });
const subscribe = (socket: Socket, payload: unknown) =>
  socket.timeout(3000).emitWithAck('queue:subscribe', payload) as Promise<{
    ok: boolean;
    error?: { code: string };
  }>;
const inRoom = async (room: string) => (await io.in(room).fetchSockets()).length;

let tz: string;
let today: string;
let reception: LoggedIn;
let doctor: LoggedIn & { id: string };

describe('Socket.IO', () => {
  let emails: ReturnType<typeof captureEmails>;
  beforeAll(async () => {
    await Appointment.init();
    const http = createServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    io = initSocket(http);
  });
  afterAll(async () => {
    setSocketServer(null);
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  beforeEach(async () => {
    await resetDb();
    emails = captureEmails();
    tz = await useMiddayClinicZone();
    today = clinicToday(tz);
    reception = await loginAs('receptionist');
    doctor = await loginAsDoctor();
  });
  afterEach(() => {
    emails.restore();
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  describe('handshake', () => {
    it('no token, a bad token or a wrong kiosk key → rejected', async () => {
      expect((await rejected(client({}))).data).toEqual({ code: 'UNAUTHORIZED' });
      expect((await rejected(client({ token: 'not.a.jwt' }))).data).toEqual({
        code: 'UNAUTHORIZED',
      });
      expect((await rejected(client({ kioskKey: 'wrong' }))).data).toEqual({
        code: 'UNAUTHORIZED',
      });
    });

    it('a logged-out session → SESSION_REVOKED (same checks as authenticate)', async () => {
      const staff = await loginAs('receptionist');
      await api().post('/api/v1/auth/logout').set(staff.auth);
      expect((await rejected(client({ token: staff.token }))).data).toEqual({
        code: 'SESSION_REVOKED',
      });
    });

    it('a deactivated account → ACCOUNT_INACTIVE', async () => {
      const staff = await loginAs('receptionist');
      await staff.user.updateOne({ $set: { isActive: false } });
      expect((await rejected(client({ token: staff.token }))).data).toEqual({
        code: 'ACCOUNT_INACTIVE',
      });
    });

    it('a user joins their own user room; the kiosk joins the board room only', async () => {
      await connected(client({ token: reception.token }));
      expect(await inRoom(`user:${reception.user._id}`)).toBe(1);
      await connected(client({ kioskKey: config.kiosk.key }));
      expect(await inRoom('board')).toBe(1);
    });
  });

  describe('queue:subscribe', () => {
    it('reception may follow any doctor; a doctor only their own', async () => {
      const other = await createDoctor();
      const staff = client({ token: reception.token });
      await connected(staff);
      expect(await subscribe(staff, { doctorId: other.id, date: today })).toEqual({ ok: true });
      expect(await inRoom(`queue:${other.id}:${today}`)).toBe(1);

      const dr = client({ token: doctor.token });
      await connected(dr);
      expect(await subscribe(dr, { doctorId: doctor.id, date: today })).toEqual({ ok: true });
      expect(await subscribe(dr, { doctorId: other.id, date: today })).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(await inRoom(`queue:${other.id}:${today}`)).toBe(1); // still only reception
    });

    it('a patient only for a doctor they have an appointment with that day', async () => {
      const me = await loginAsPatient();
      const socket = client({ token: me.token });
      await connected(socket);
      expect(await subscribe(socket, { doctorId: doctor.id, date: today })).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      await insertAppointment({
        patient: me.patientId,
        doctor: doctor.id,
        startAt: zonedDateTimeToUtc(today, '11:00', tz),
        status: 'checked_in',
      });
      expect(await subscribe(socket, { doctorId: doctor.id, date: today })).toEqual({ ok: true });
    });

    it('lab techs cannot follow queues; bad payloads are refused', async () => {
      const lab = await loginAs('labtech');
      const socket = client({ token: lab.token });
      await connected(socket);
      expect(await subscribe(socket, { doctorId: doctor.id, date: today })).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      expect(await subscribe(socket, { doctorId: 'x', date: 'today' })).toMatchObject({
        ok: false,
        error: { code: 'BAD_REQUEST' },
      });
    });

    it('re-checks the session on every subscribe', async () => {
      const staff = await loginAs('receptionist');
      const socket = client({ token: staff.token });
      await connected(socket);
      await api().post('/api/v1/auth/logout').set(staff.auth);
      expect(await subscribe(socket, { doctorId: doctor.id, date: today })).toMatchObject({
        ok: false,
        error: { code: 'SESSION_REVOKED' },
      });
    });
  });

  describe('events', () => {
    it('check-in: queue.updated to the queue room and the board, appointment.changed to the patient – after commit, ids only', async () => {
      const me = await loginAsPatient();
      const appt = await insertAppointment({
        patient: me.patientId,
        doctor: doctor.id,
        startAt: zonedDateTimeToUtc(today, '11:00', tz),
      });
      const staff = client({ token: reception.token });
      const kiosk = client({ kioskKey: config.kiosk.key });
      const patient = client({ token: me.token });
      const otherDoctor = await loginAsDoctor();
      const bystander = client({ token: otherDoctor.token });
      await Promise.all([staff, kiosk, patient, bystander].map(connected));
      await subscribe(staff, { doctorId: doctor.id, date: today });
      await subscribe(bystander, { doctorId: otherDoctor.id, date: today });

      const staffEvent = nextEvent<Record<string, unknown>>(staff, 'queue.updated').then(
        async (payload) => ({
          payload,
          // Emitted after the commit: the change is already visible.
          statusThen: (await Appointment.findById(appt._id).lean())!.status,
        }),
      );
      const boardEvent = nextEvent(kiosk, 'queue.updated');
      const patientEvent = nextEvent(patient, 'appointment.changed');
      const quiet = noEvent(bystander, 'queue.updated');

      const res = await api()
        .post(`/api/v1/appointments/${appt._id}/check-in`)
        .set(reception.auth)
        .send({});
      expect(res.status).toBe(200);

      const { payload, statusThen } = await staffEvent;
      expect(payload).toEqual({ doctorId: doctor.id, date: today });
      expect(statusThen).toBe('checked_in');
      expect(await boardEvent).toEqual({ doctorId: doctor.id, date: today });
      expect(await patientEvent).toEqual({ appointmentId: appt._id.toString() });
      await quiet;
    });

    it('booking, cancel and call-next also announce the change', async () => {
      const staff = client({ token: reception.token });
      await connected(staff);
      await subscribe(staff, { doctorId: doctor.id, date: today });
      const appt = await insertAppointment({
        patient: (await createPatient()).id,
        doctor: doctor.id,
        startAt: zonedDateTimeToUtc(today, '11:00', tz),
        status: 'checked_in',
        queue: { tokenNumber: 1, checkedInAt: new Date() },
      });

      const called = nextEvent(staff, 'queue.updated');
      await api().post('/api/v1/queue/call-next').set(doctor.auth).send({});
      expect(await called).toEqual({ doctorId: doctor.id, date: today });

      const drSocket = client({ token: doctor.token });
      await connected(drSocket);
      const changed = nextEvent(drSocket, 'appointment.changed');
      await api().post(`/api/v1/appointments/${appt._id}/complete`).set(doctor.auth).send({});
      expect(await changed).toEqual({ appointmentId: appt._id.toString() });
    });

    it('a failed action emits nothing', async () => {
      const staff = client({ token: reception.token });
      await connected(staff);
      await subscribe(staff, { doctorId: doctor.id, date: today });
      const appt = await insertAppointment({
        patient: (await createPatient()).id,
        doctor: doctor.id,
        startAt: zonedDateTimeToUtc(today, '11:00', tz),
        status: 'cancelled',
      });
      const quiet = noEvent(staff, 'queue.updated');
      const res = await api()
        .post(`/api/v1/appointments/${appt._id}/check-in`)
        .set(reception.auth)
        .send({});
      expect(res.status).toBe(409);
      await quiet;
    });
  });
});
