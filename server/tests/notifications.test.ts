import type { Server } from 'socket.io';
import { NOTIFICATION_CONFIG, NOTIFICATION_TYPE_VALUES } from '../src/config/constants.js';
import { FORMULARY } from '../src/data/formulary.js';
import { patientRecipient } from '../src/modules/appointments/service.js';
import { Notification } from '../src/modules/notifications/model.js';
import { emailService } from '../src/services/email.service.js';
import { configureEmailQueue } from '../src/services/emailQueue.js';
import { notify, notificationLink } from '../src/services/notification.service.js';
import { NOTIFICATION_EMAILS } from '../src/services/notificationEmails/index.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { logger } from '../src/utils/logger.js';
import { createUser, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { createPatient, setSettings } from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * The notification centre (spec §11, §6.24, §7.17, Phase 10): notify() stores, emits and queues
 * the email; the clinic switch, patient consent and the type decide about email; dedupe keys
 * make an event happen once; data passes an allow-list; email templates carry no clinical
 * details or amounts; the endpoints only ever touch the caller's own notifications.
 */

let emails: ReturnType<typeof captureEmails>;
let events: { rooms: string[]; event: string; payload: unknown }[];
beforeEach(async () => {
  await resetDb();
  await Notification.init();
  emails = captureEmails();
  events = [];
  setSocketServer({
    to: (rooms: string | string[]) => ({
      emit: (event: string, payload: unknown) =>
        events.push({ rooms: ([] as string[]).concat(rooms), event, payload }),
    }),
  } as unknown as Server);
});
afterEach(() => {
  emails.restore();
  setSocketServer(null);
  configureEmailQueue({ delaysMs: [0, 0, 0] });
});

const booked = (userId: string, extra: Partial<Parameters<typeof notify>[0]> = {}) =>
  notify({
    recipients: [{ userId, email: 'p@example.com' }],
    type: 'appointment.booked',
    title: 'Appointment confirmed',
    body: 'Your appointment APT-2026-000001 is booked.',
    link: '/patient/appointments',
    data: {
      appointmentId: '0123456789abcdef01234567',
      appointmentNumber: 'APT-2026-000001',
      startAt: '2026-10-20T04:00:00.000Z',
    },
    ...extra,
  });

describe('notify()', () => {
  it('stores the record, emits it with the unread count and queues the email', async () => {
    const user = await createUser('patient');
    await booked(user._id.toString());

    const [n] = await Notification.find().lean();
    expect(n).toMatchObject({
      type: 'appointment.booked',
      priority: 'normal',
      title: 'Appointment confirmed',
      link: '/patient/appointments',
      readAt: null,
      data: { appointmentNumber: 'APT-2026-000001' },
      channels: { inApp: true, email: { queued: true, sent: true, attempts: 1 } },
    });
    expect(n!.recipient.toString()).toBe(user._id.toString());

    const event = events.find((e) => e.event === 'notification.new');
    expect(event?.rooms).toEqual([`user:${user._id.toString()}`]);
    expect(event?.payload).toMatchObject({
      notification: { id: n!._id.toString(), title: 'Appointment confirmed' },
      unreadCount: 1,
    });

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]).toMatchObject({ to: 'p@example.com', subject: 'Appointment confirmed' });
    // The email comes from the template (data), never the in-app body.
    expect(emails.sent[0]!.text).toContain('APT-2026-000001');
    expect(emails.sent[0]!.links).toEqual(['http://localhost:5173/patient/appointments']);
  });

  it('skips the email when the clinic turned email off (in-app still stored)', async () => {
    await setSettings({ 'notifications.emailEnabled': false });
    const user = await createUser('patient');
    await booked(user._id.toString());
    expect(emails.sent).toHaveLength(0);
    const n = await Notification.findOne().lean();
    expect(n?.channels?.email).toMatchObject({ queued: false, sent: false });
  });

  it('account emails go out even with clinic email off, and are never stored', async () => {
    await setSettings({ 'notifications.emailEnabled': false });
    await notify({
      recipients: [{ userId: '0123456789abcdef01234567', email: 'new@clinic.dev' }],
      type: 'account.password_reset',
      title: 'Reset your MedAssist password',
      body: 'Use the link.',
      link: '/reset-password/abc',
    });
    expect(emails.sent).toHaveLength(1);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('patients get email only with email consent (patientRecipient)', async () => {
    const withConsent = await createPatient({ email: 'yes@example.com' });
    const without = await createPatient({
      email: 'no@example.com',
      consent: {
        dataProcessing: { given: true, at: new Date() },
        communications: { email: false, sms: false },
      },
    });
    expect((await patientRecipient(withConsent.id)).email).toBe('yes@example.com');
    expect((await patientRecipient(without.id)).email).toBeNull();
  });

  it('types without email (in-app only) never send one', async () => {
    const user = await createUser('patient');
    await notify({
      recipients: [{ userId: user._id.toString(), email: 'p@example.com' }],
      type: 'prescription.issued',
      title: 'New prescription',
      body: 'Log in to view it.',
    });
    expect(NOTIFICATION_CONFIG['prescription.issued'].email).toBe(false);
    expect(emails.sent).toHaveLength(0);
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('a dedupe key makes the event happen once per recipient – also for 5 parallel calls', async () => {
    const a = (await createUser('patient'))._id.toString();
    const b = (await createUser('patient'))._id.toString();
    const call = () =>
      notify({
        recipients: [
          { userId: a, email: 'a@example.com' },
          { userId: b, email: 'b@example.com' },
        ],
        type: 'appointment.reminder',
        title: 'Appointment reminder',
        body: 'Reminder.',
        dedupeKey: 'appointment.reminder:abc',
      });
    await Promise.all([call(), call(), call(), call(), call()]);
    await call();
    expect(await Notification.countDocuments({ recipient: a })).toBe(1);
    expect(await Notification.countDocuments({ recipient: b })).toBe(1);
    expect(emails.sent.map((m) => m.to).sort()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('drops data that is not on the allow-list (no clinical content)', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const user = await createUser('patient');
    await booked(user._id.toString(), {
      data: { appointmentId: '0123456789abcdef01234567', drug: 'Amoxicillin 500 mg' },
    });
    await booked(user._id.toString(), { data: { status: 'Has fever' } });
    const docs = await Notification.find().lean();
    expect(JSON.stringify(docs)).not.toMatch(/Amoxicillin|fever/);
    expect(warn).toHaveBeenCalledWith(
      { type: 'appointment.booked' },
      'Notification data dropped (not on the allow-list)',
    );
    warn.mockRestore();
  });

  it('retries a failing email with backoff and stores the outcome – never throws', async () => {
    emails.restore();
    const send = vi
      .spyOn(emailService, 'send')
      .mockRejectedValueOnce(Object.assign(new Error('smtp down'), { code: 'ECONNREFUSED' }))
      .mockRejectedValueOnce(new Error('again'))
      .mockResolvedValue(undefined);
    const user = await createUser('patient');
    await booked(user._id.toString());
    expect(send).toHaveBeenCalledTimes(3);
    let n = await Notification.findOne().lean();
    expect(n?.channels?.email).toMatchObject({ sent: true, attempts: 3, error: null });

    send.mockReset();
    send.mockRejectedValue(Object.assign(new Error('secret body text'), { code: 'EAUTH' }));
    await Notification.deleteMany({});
    await expect(booked(user._id.toString())).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(4); // 1 try + 3 retries
    n = await Notification.findOne().lean();
    expect(n?.channels?.email).toMatchObject({ sent: false, attempts: 4, error: 'EAUTH' });
    send.mockRestore();
    emails = captureEmails();
  });

  it('builds role links from the catalogue', () => {
    expect(notificationLink('lab.result_released', 'patient', 'abc')).toBe(
      '/patient/lab-reports/abc',
    );
    expect(notificationLink('lab.result_released', 'doctor', 'abc')).toBe('/doctor/lab-orders/abc');
    expect(notificationLink('lab.result_released', 'admin', 'abc')).toBeUndefined();
  });
});

describe('email templates', () => {
  /** Clinical words from the seed (diagnoses, drug names, results) and money. */
  const FORBIDDEN = [
    /diagnos/i,
    /pharyngitis|fever|diabetes|hypertension|infection|asthma|gastritis/i,
    /haemoglobin|glucose|cholesterol|mg\/dl|mmol|positive|negative|critical_|\bflag/i,
    /₹|\bRs\.?\b|\bINR\b|paise|amount|total|balance/i,
    new RegExp(
      FORMULARY.map((d) => d.name.split(' ')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'i',
    ),
  ];
  const data = {
    appointmentId: '0123456789abcdef01234567',
    appointmentNumber: 'APT-2026-000123',
    startAt: '2026-10-20T04:00:00.000Z',
    tokenNumber: 4,
    labOrderId: '0123456789abcdef01234567',
    orderNumber: 'LAB-2026-000045',
    invoiceId: '0123456789abcdef01234567',
    invoiceNumber: 'INV-2026-000077',
    requestNumber: 'FUR-2026-000003',
    dueDate: '2026-10-25',
    count: 3,
  };

  it.each(NOTIFICATION_TYPE_VALUES)(
    '%s has a template with no clinical content or amounts',
    (type) => {
      const t = NOTIFICATION_EMAILS[type]({
        clinicName: 'Sunrise Clinic',
        timezone: 'Asia/Kolkata',
        url: 'http://localhost:5173/patient/dashboard',
        data,
      });
      expect(t.subject.length).toBeGreaterThan(3);
      for (const part of [t.subject, t.text, t.html]) {
        for (const word of FORBIDDEN) expect(part, `${type}: ${word}`).not.toMatch(word);
      }
      expect(t.text).toContain('Sunrise Clinic');
      expect(t.html).toContain('href="http://localhost:5173/patient/dashboard"');
    },
  );
});

describe('/notifications', () => {
  let me: LoggedIn;
  let other: LoggedIn;
  const make = (recipient: unknown, title: string, createdAt: Date, readAt: Date | null = null) =>
    Notification.create({ recipient, type: 'invoice.issued', title, createdAt, readAt });

  beforeEach(async () => {
    me = await loginAs('patient');
    other = await loginAs('patient');
    const t = Date.now();
    await make(me.user._id, 'Oldest', new Date(t - 3000));
    await make(me.user._id, 'Read one', new Date(t - 2000), new Date());
    await make(me.user._id, 'Newest', new Date(t - 1000));
    await make(other.user._id, 'Not mine', new Date(t));
  });

  const get = (who: LoggedIn, path: string) => api().get(`/api/v1${path}`).set(who.auth);
  const post = (who: LoggedIn, path: string) => api().post(`/api/v1${path}`).set(who.auth);

  it('lists own notifications newest first, with ?unread and pagination', async () => {
    const all = await get(me, '/notifications');
    expect(all.status).toBe(200);
    expect(all.body.data.map((n: { title: string }) => n.title)).toEqual([
      'Newest',
      'Read one',
      'Oldest',
    ]);
    expect(all.body.meta).toMatchObject({ total: 3, unreadCount: 2 });
    const unread = await get(me, '/notifications?unread=true&limit=1');
    expect(unread.body.data.map((n: { title: string }) => n.title)).toEqual(['Newest']);
    expect(unread.body.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect((await get(me, '/notifications/unread-count')).body.data).toEqual({ unreadCount: 2 });
  });

  it('marks one read (own only – another user’s id is 404) and tells the other tabs', async () => {
    const mine = await Notification.findOne({ title: 'Newest' }).lean();
    const theirs = await Notification.findOne({ title: 'Not mine' }).lean();
    const res = await post(me, `/notifications/${mine!._id.toString()}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(1);
    expect(res.body.data.notification.readAt).not.toBeNull();
    expect(events).toContainEqual({
      rooms: [`user:${me.user._id.toString()}`],
      event: 'notification.read',
      payload: { ids: [mine!._id.toString()], unreadCount: 1 },
    });

    const denied = await post(me, `/notifications/${theirs!._id.toString()}/read`);
    expect(denied.status).toBe(404);
    expect((await Notification.findById(theirs!._id).lean())?.readAt).toBeNull();
  });

  it('read-all affects only the caller', async () => {
    const res = await post(me, '/notifications/read-all');
    expect(res.body.data).toEqual({ updated: 2, unreadCount: 0 });
    expect(await Notification.countDocuments({ recipient: me.user._id, readAt: null })).toBe(0);
    expect(await Notification.countDocuments({ recipient: other.user._id, readAt: null })).toBe(1);
    expect(events.at(-1)).toMatchObject({ event: 'notification.read', payload: { ids: 'all' } });
  });
});

describe('client mirror', () => {
  it('client/src/constants/notifications.ts lists exactly the server types', async () => {
    const { readFile } = await import('node:fs/promises');
    const file = await readFile(
      new URL('../../client/src/constants/notifications.ts', import.meta.url),
      'utf8',
    );
    const list = file.slice(file.indexOf('NOTIFICATION_TYPES = ['), file.indexOf('] as const'));
    const client = [...list.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
    expect(client).toEqual([...NOTIFICATION_TYPE_VALUES]);
  });
});
