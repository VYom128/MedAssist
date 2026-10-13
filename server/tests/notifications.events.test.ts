import { Types } from 'mongoose';
import { runFollowUpReminderJob } from '../src/jobs/followUpReminders.job.js';
import { runLabTatJob } from '../src/jobs/labTat.job.js';
import { runNoShowJob } from '../src/jobs/noShow.job.js';
import { runReminderJob } from '../src/jobs/reminders.job.js';
import type { NotificationType } from '../src/config/constants.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { FollowupReminder } from '../src/modules/followupReminders/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Notification } from '../src/modules/notifications/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import {
  addDaysToDate,
  calendarDate,
  clinicToday,
  toClinicTime,
  zonedDateTimeToUtc,
} from '../src/utils/dates.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  checkedInToday,
  createLabTest,
  createSchedule,
  createService,
  insertAppointment,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
  readyToSign,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Every §11 event fires once, from its trigger (the service call or job that causes it), to the
 * right recipients (Phase 10). Jobs run twice to prove the dedupe/claim. Table-driven: each row
 * runs the trigger and returns the user ids that must hold exactly one notification of the type.
 */

let emails: ReturnType<typeof captureEmails>;
let tz: string;
beforeEach(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    LabOrder.init(),
    Invoice.init(),
    Payment.init(),
    Notification.init(),
  ]);
  tz = await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const post = (who: LoggedIn, path: string, body: object = {}) =>
  api().post(`/api/v1${path}`).set(who.auth).send(body);
const ok = async (res: Promise<{ status: number; body: unknown }>, status = 200) => {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body as { data: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const uid = (who: LoggedIn) => who.user._id.toString();

/** A clinic-time slot today `minutesAhead` from now, on the 15-minute grid. */
function slotToday(minutesAhead: number): Date {
  const t = new Date(Date.now() + minutesAhead * 60_000);
  const [h, m] = toClinicTime(t, tz).split(':').map(Number) as [number, number];
  const rounded = Math.ceil(m / 15) * 15;
  const hh = h + Math.floor(rounded / 60);
  const time = `${String(hh).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
  return zonedDateTimeToUtc(clinicToday(tz), time, tz);
}

/** A doctor who works all day, a service, a patient with a login and a receptionist. */
async function clinic() {
  const doctor = await loginAsDoctor();
  await createSchedule(doctor.id, [{ start: '00:00', end: '23:55' }]);
  const service = await createService();
  const patient = await loginAsPatient({ email: 'pat@example.com' });
  const reception = await loginAs('receptionist');
  return { doctor, service, patient, reception };
}
type Clinic = Awaited<ReturnType<typeof clinic>>;

async function bookToday(c: Clinic) {
  const body = await ok(
    post(c.reception, '/appointments', {
      patientId: c.patient.patientId,
      doctorId: c.doctor.id,
      serviceId: c.service._id.toString(),
      startAt: slotToday(60).toISOString(),
    }),
    201,
  );
  return body.data.id as string;
}

/** A placed lab order for the patient of a signed note, and two lab technicians. */
async function placedOrder() {
  const patient = await loginAsPatient({ gender: 'male', dateOfBirth: '1980-01-01' });
  const c = await readyToSign({ patientId: patient.patientId, items: [] });
  await signNote(c.doctor, c.encounterId);
  const test = await createLabTest();
  const order = await ok(
    post(c.doctor, '/lab-orders', { encounterId: c.encounterId, testIds: [test._id.toString()] }),
    201,
  );
  const lab1 = await loginAs('labtech');
  const lab2 = await loginAs('labtech');
  const id = order.data.id as string;
  const itemId = order.data.items[0].id as string;
  const processing = async () => {
    await ok(post(lab1, `/lab-orders/${id}/collect-sample`));
    await ok(post(lab1, `/lab-orders/${id}/start-processing`));
  };
  const enter = (hb: number) =>
    api()
      .put(`/api/v1/lab-orders/${id}/items/${itemId}/results`)
      .set(lab1.auth)
      .send({
        results: [
          { parameterKey: 'hb', value: hb },
          { parameterKey: 'smear', value: 'Negative' },
        ],
      });
  return { ...c, patient, id, lab1, lab2, processing, enter };
}

async function followupRequest() {
  const c = await clinic();
  const visit = await insertAppointment({
    patient: c.patient.patientId,
    doctor: c.doctor.id,
    startAt: new Date(Date.now() - 5 * 86_400_000),
    status: 'completed',
    isSlotActive: false,
  });
  const created = await ok(
    post(c.patient, '/follow-up-requests', {
      relatedAppointmentId: visit._id.toString(),
      type: 'question',
      message: 'Can I take the tablets after food?',
    }),
    201,
  );
  return { ...c, requestId: created.data.id as string };
}

interface Row {
  type: NotificationType;
  /** Runs the trigger; returns the users who must have exactly one notification of `type`. */
  run: () => Promise<string[]>;
}

const ROWS: Row[] = [
  {
    type: 'appointment.booked',
    run: async () => {
      const c = await clinic();
      await bookToday(c); // same day → the doctor is told too
      return [uid(c.patient), c.doctor.id];
    },
  },
  {
    type: 'appointment.rescheduled',
    run: async () => {
      const c = await clinic();
      const id = await bookToday(c);
      await ok(
        post(c.reception, `/appointments/${id}/reschedule`, {
          startAt: slotToday(120).toISOString(),
          reason: 'Doctor running late',
        }),
      );
      return [uid(c.patient), c.doctor.id];
    },
  },
  {
    type: 'appointment.cancelled',
    run: async () => {
      const c = await clinic();
      const id = await bookToday(c);
      await ok(post(c.reception, `/appointments/${id}/cancel`, { reason: 'Patient called' }));
      return [uid(c.patient), c.doctor.id];
    },
  },
  {
    type: 'appointment.reminder',
    run: async () => {
      const c = await clinic();
      await insertAppointment({
        patient: c.patient.patientId,
        doctor: c.doctor.id,
        startAt: new Date(Date.now() + 24 * 3_600_000),
      });
      await runReminderJob();
      await runReminderJob();
      return [uid(c.patient)];
    },
  },
  {
    type: 'appointment.no_show',
    run: async () => {
      const c = await clinic();
      await insertAppointment({
        patient: c.patient.patientId,
        doctor: c.doctor.id,
        startAt: new Date(Date.now() - 3 * 3_600_000),
      });
      await runNoShowJob();
      await runNoShowJob();
      return [uid(c.patient)];
    },
  },
  {
    type: 'appointment.checked_in',
    run: async () => {
      const c = await clinic();
      const id = await bookToday(c);
      await ok(post(c.reception, `/appointments/${id}/check-in`));
      return [uid(c.patient)];
    },
  },
  {
    type: 'queue.your_turn',
    run: async () => {
      const doctor = await loginAsDoctor();
      const first = await loginAsPatient();
      const second = await loginAsPatient();
      await checkedInToday(doctor.id, { patientId: first.patientId });
      await checkedInToday(doctor.id, { patientId: second.patientId });
      await ok(post(doctor, '/queue/call-next')); // first goes in → second is next
      return [uid(second)];
    },
  },
  {
    type: 'doctor.leave_affects_appointments',
    run: async () => {
      const c = await clinic();
      const admin = await loginAs('admin');
      const day = addDaysToDate(clinicToday(tz), 3);
      await insertAppointment({
        patient: c.patient.patientId,
        doctor: c.doctor.id,
        startAt: zonedDateTimeToUtc(day, '10:00', tz),
      });
      await ok(post(admin, `/doctors/${c.doctor.id}/leaves`, { date: day, fullDay: true }), 201);
      return [uid(c.reception)];
    },
  },
  {
    type: 'prescription.issued',
    run: async () => {
      const patient = await loginAsPatient();
      const c = await readyToSign({ patientId: patient.patientId });
      await signNote(c.doctor, c.encounterId);
      return [uid(patient)];
    },
  },
  {
    type: 'invoice.issued',
    run: async () => {
      const c = await clinic();
      const inv = await ok(
        post(c.reception, '/invoices', {
          patientId: c.patient.patientId,
          items: [{ kind: 'other', description: 'Dressing', unitPricePaise: 30_000 }],
        }),
        201,
      );
      await ok(post(c.reception, `/invoices/${inv.data.id}/issue`, { expectedVersion: 0 }));
      return [uid(c.patient)];
    },
  },
  {
    type: 'payment.received',
    run: async () => {
      const c = await clinic();
      const inv = await ok(
        post(c.reception, '/invoices', {
          patientId: c.patient.patientId,
          items: [{ kind: 'other', description: 'Dressing', unitPricePaise: 30_000 }],
        }),
        201,
      );
      await ok(post(c.reception, `/invoices/${inv.data.id}/issue`, { expectedVersion: 0 }));
      await ok(
        post(c.reception, `/invoices/${inv.data.id}/payments`, {
          amountPaise: 30_000,
          method: 'cash',
        }),
        201,
      );
      return [uid(c.patient)];
    },
  },
  {
    type: 'lab.sample_rejected',
    run: async () => {
      const reception = await loginAs('receptionist');
      const o = await placedOrder();
      await ok(post(o.lab1, `/lab-orders/${o.id}/collect-sample`));
      await ok(post(o.lab1, `/lab-orders/${o.id}/reject-sample`, { reason: 'Haemolysed' }));
      return [uid(o.patient), uid(reception)];
    },
  },
  {
    type: 'lab.critical_value',
    run: async () => {
      const o = await placedOrder();
      await o.processing();
      await ok(o.enter(4));
      return [o.doctor.id];
    },
  },
  {
    type: 'lab.result_released',
    run: async () => {
      const o = await placedOrder();
      await o.processing();
      await ok(o.enter(14.2));
      await ok(post(o.lab2, `/lab-orders/${o.id}/verify`));
      await ok(post(o.lab2, `/lab-orders/${o.id}/release`));
      return [uid(o.patient), o.doctor.id];
    },
  },
  {
    type: 'lab.tat_overdue',
    run: async () => {
      const doctor = await loginAsDoctor();
      const patient = await loginAsPatient();
      const lab = await loginAs('labtech');
      await insertLabOrder({
        patient: patient.patientId,
        doctor: doctor.id,
        orderedAt: new Date(Date.now() - 3 * 86_400_000),
        items: [
          {
            test: new Types.ObjectId(),
            testSnapshot: { code: 'CBC', name: 'CBC', pricePaise: 100, turnaroundHours: 4 },
          },
        ],
      });
      await runLabTatJob();
      await runLabTatJob();
      return [uid(lab)];
    },
  },
  {
    type: 'followup.reminder',
    run: async () => {
      const c = await clinic();
      const visit = await insertAppointment({
        patient: c.patient.patientId,
        doctor: c.doctor.id,
        startAt: new Date(Date.now() - 5 * 86_400_000),
        status: 'completed',
        isSlotActive: false,
      });
      await FollowupReminder.create({
        encounter: new Types.ObjectId(),
        appointment: visit._id,
        patient: c.patient.patientId,
        doctor: c.doctor.id,
        visitAt: visit.startAt,
        dueDate: calendarDate(addDaysToDate(clinicToday(tz), 2)),
      });
      await runFollowUpReminderJob();
      await runFollowUpReminderJob();
      return [uid(c.patient)];
    },
  },
  {
    type: 'followup.request_new',
    run: async () => {
      const c = await followupRequest();
      return [c.doctor.id, uid(c.reception)];
    },
  },
  {
    type: 'followup.request_updated',
    run: async () => {
      const c = await followupRequest();
      await ok(
        post(c.reception, `/follow-up-requests/${c.requestId}/messages`, {
          text: 'Yes, after food.',
        }),
        201,
      );
      return [uid(c.patient)];
    },
  },
  {
    type: 'followup.request_reply',
    run: async () => {
      const c = await followupRequest();
      await ok(
        post(c.reception, `/follow-up-requests/${c.requestId}/messages`, {
          text: 'Yes, after food.',
        }),
        201,
      );
      await ok(
        post(c.patient, `/follow-up-requests/${c.requestId}/messages`, { text: 'Thank you' }),
        201,
      );
      return [c.doctor.id, uid(c.reception)];
    },
  },
];

describe.each(ROWS)('$type', ({ type, run }) => {
  it('fires once to each recipient', async () => {
    const recipients = await run();
    await vi.waitFor(async () =>
      expect(await Notification.countDocuments({ type })).toBe(recipients.length),
    );
    for (const id of recipients) {
      expect(await Notification.countDocuments({ type, recipient: id }), `${type} → ${id}`).toBe(1);
    }
    const docs = await Notification.find({ type }).lean();
    for (const n of docs) {
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.link).toMatch(/^\/(patient|doctor|reception|lab|admin)\//);
    }
  });
});

describe('account emails (email only, never stored)', () => {
  it('a new staff account gets the set-password email', async () => {
    const admin = await loginAs('admin');
    await ok(
      post(admin, '/users', {
        firstName: 'Ravi',
        lastName: 'Kumar',
        email: 'ravi@clinic.dev',
        role: 'receptionist',
      }),
      201,
    );
    await vi.waitFor(() => expect(emails.sent).toHaveLength(1));
    expect(emails.sent[0]).toMatchObject({
      to: 'ravi@clinic.dev',
      subject: 'Your MedAssist account',
    });
    expect(emails.sent[0]!.links![0]).toMatch(/\/reset-password\/[\w-]+$/);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('a password reset gets the reset email', async () => {
    const user = await loginAs('labtech');
    await ok(post(user, '/auth/forgot-password', { email: user.user.email }));
    await vi.waitFor(() => expect(emails.sent).toHaveLength(1));
    expect(emails.sent[0]!.subject).toBe('Reset your MedAssist password');
    expect(await Notification.countDocuments()).toBe(0);
  });
});
