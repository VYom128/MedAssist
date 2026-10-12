import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  checkedInToday,
  createPatient,
  insertAppointment,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Role dashboards (spec §14, Phase 10): one call per role; doctors and patients see only their
 * own numbers; every admin number equals the matching report total for the same range.
 */

let emails: ReturnType<typeof captureEmails>;
let s: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const doctorA = await loginAsDoctor();
  const doctorB = await loginAsDoctor();
  const patient = await loginAsPatient({ email: 'p@example.com' });
  const other = await createPatient();
  // Today: A has 2 waiting + 1 in consultation (a draft note) + 1 done; B has 1 waiting.
  await checkedInToday(doctorA.id, { patientId: patient.patientId });
  await checkedInToday(doctorA.id);
  await checkedInToday(doctorB.id, { patientId: other.id });
  const consult = await startedConsultation(doctorA);
  await Encounter.collection.updateOne(
    { _id: new Types.ObjectId(consult.encounterId) },
    { $set: { createdAt: new Date(Date.now() - 30 * 3_600_000) } },
  );
  await insertAppointment({
    patient: other.id,
    doctor: doctorA.id,
    startAt: new Date(Date.now() - 2 * 3_600_000),
    status: 'completed',
    isSlotActive: false,
  });
  await insertAppointment({
    patient: patient.patientId,
    doctor: doctorA.id,
    startAt: new Date(Date.now() + 2 * 86_400_000),
  });
  // Lab: A's released order not reviewed yet (one critical); B's too.
  const placed = {
    orderedAt: new Date(Date.now() - 5 * 3_600_000),
    releasedAt: new Date(Date.now() - 3_600_000),
  };
  await insertLabOrder({
    patient: patient.patientId,
    doctor: doctorA.id,
    status: 'released',
    hasCritical: true,
    ...placed,
  });
  await insertLabOrder({ patient: other.id, doctor: doctorB.id, status: 'released', ...placed });
  await insertLabOrder({
    patient: other.id,
    doctor: doctorB.id,
    status: 'ordered',
    priority: 'urgent',
  });
  // Billing: the patient owes 500 on an invoice issued today; the other patient owes 900.
  const invoice = (pid: string, balancePaise: number) => ({
    patient: new Types.ObjectId(pid),
    kind: 'manual',
    status: 'partially_paid',
    invoiceNumber: `INV-2026-${String(balancePaise).padStart(6, '0')}`,
    issuedAt: new Date(),
    totalPaise: 100_000,
    balancePaise,
    items: [],
  });
  const ins = await Invoice.collection.insertMany([
    invoice(patient.patientId, 50_000),
    invoice(other.id, 90_000),
  ]);
  await Payment.collection.insertOne({
    paymentNumber: 'PAY-2026-000001',
    invoice: ins.insertedIds[0],
    patient: new Types.ObjectId(patient.patientId),
    amountPaise: 50_000,
    method: 'cash',
    kind: 'payment',
    receivedBy: new Types.ObjectId(),
    receivedAt: new Date(),
  });
  return { doctorA, doctorB, patient, other };
}

beforeAll(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    LabOrder.init(),
    Invoice.init(),
    Payment.init(),
  ]);
  await useMiddayClinicZone();
  emails = captureEmails();
  s = await setup();
}, 60_000);
afterAll(() => emails.restore());

const get = async (who: LoggedIn, path: string) => {
  const res = await api().get(`/api/v1${path}`).set(who.auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe('GET /dashboard/doctor', () => {
  it('counts only the doctor’s own queue, drafts, results and week', async () => {
    const { data } = await get(s.doctorA, '/dashboard/doctor');
    expect(data.queueToday).toMatchObject({ waiting: 2, inConsultation: 1, done: 1 });
    expect(data.nextPatient).toMatchObject({ appointmentNumber: expect.any(String) });
    expect(data.unsignedDrafts).toMatchObject({ count: 1, olderThan24h: 1 });
    expect(data.unsignedDrafts.items[0].olderThan24h).toBe(true);
    expect(data.resultsToReview).toMatchObject({ count: 1, critical: 1 });
    expect(data.resultsToReview.items[0].hasCritical).toBe(true);
    expect(data.weekAppointments.total).toBeGreaterThanOrEqual(4);

    const b = (await get(s.doctorB, '/dashboard/doctor')).data;
    expect(b.queueToday).toMatchObject({ waiting: 1, inConsultation: 0, done: 0 });
    expect(b.unsignedDrafts.count).toBe(0);
    expect(b.resultsToReview).toMatchObject({ count: 1, critical: 0 });
  });
});

describe('GET /dashboard/patient', () => {
  it('shows only the patient’s own records', async () => {
    const { data } = await get(s.patient, '/dashboard/patient');
    expect(data.nextAppointment).toMatchObject({ status: 'checked_in' }); // today, checked in
    expect(data.nextAppointment.queue).toMatchObject({ position: expect.any(Number) });
    expect(data.outstanding).toEqual({ invoices: 1, balancePaise: 50_000 });
    expect(data.newReports.count).toBe(1);
    expect(data.quickActions.map((a: { key: string }) => a.key)).toEqual([
      'book_appointment',
      'request_follow_up',
    ]);
    expect(JSON.stringify(data)).not.toContain('90000');
  });

  it('403 while the sign-up waits for verification', async () => {
    const p = await createPatient();
    const pending = await loginAs('patient', {
      patient: p.id,
      patientLinkStatus: 'pending_verification',
    });
    const res = await api().get('/api/v1/dashboard/patient').set(pending.auth);
    expect(res.status).toBe(403);
  });
});

describe('GET /dashboard/reception and /dashboard/lab', () => {
  it('reception: today by doctor, waiting, unpaid today, open follow-ups', async () => {
    const reception = await loginAs('receptionist');
    const { data } = await get(reception, '/dashboard/reception');
    expect(data.checkInsWaiting).toBe(3);
    expect(data.appointmentsByDoctor).toHaveLength(2);
    expect(data.unpaidToday.count).toBe(2);
    expect(data.unpaidToday.items[0]).toMatchObject({
      balancePaise: expect.any(Number),
      patientName: expect.any(String),
    });
    expect(data.openFollowups).toBe(0);
  });

  it('lab: open orders by status and urgent pending', async () => {
    const lab = await loginAs('labtech');
    const { data } = await get(lab, '/dashboard/lab');
    expect(data.countsByStatus.ordered).toBe(1);
    expect(data.urgentPending).toBe(1);
  });
});

describe('GET /dashboard/admin', () => {
  it('every number equals the matching report total for the same range', async () => {
    const admin = await loginAs('admin');
    // A denied access (stranger doctor → 404) becomes an audit alert without patient details.
    const stranger = await loginAsDoctor();
    await api().get(`/api/v1/patients/${s.other.id}`).set(stranger.auth);
    await flushAudit();

    const { data } = await get(admin, '/dashboard/admin');
    const { today, month, last30Days } = data.ranges;
    const report = async (type: string, from: string, to: string, extra = '') =>
      (await get(admin, `/reports/${type}?from=${from}&to=${to}${extra}`)).data;

    const appts = await report('appointments', today, today);
    expect(data.appointmentsToday.total).toBe(appts.totals.total);
    expect(data.appointmentsToday.checked_in).toBe(appts.totals.checked_in);

    const monthRevenue = await report('revenue', month.from, month.to);
    expect(data.revenue.thisMonthPaise).toBe(monthRevenue.totals.netPaise);
    expect(data.revenue.outstandingPaise).toBe(monthRevenue.totals.outstandingPaise);
    const todayRevenue = await report('revenue', today, today);
    expect(data.revenue.todayPaise).toBe(todayRevenue.totals.netPaise);
    expect(data.revenue.todayPaise).toBe(50_000);

    const noShows = await report('no-shows', last30Days.from, last30Days.to);
    expect(data.noShowRate30d.rate).toBe(noShows.totals.rate);

    const tat = await report('lab-turnaround', last30Days.from, last30Days.to);
    expect(data.labTurnaround.count).toBe(tat.totals.count);
    expect(data.labTurnaround.medianHours).toBe(tat.totals.medianHours);

    const util = await report('doctor-utilisation', last30Days.from, last30Days.to);
    expect(data.doctorUtilisation.map((d: { bookedMinutes: number }) => d.bookedMinutes)).toEqual(
      util.rows.map((d: { bookedMinutes: number }) => d.bookedMinutes),
    );

    expect(data.revenueTrend).toHaveLength(30);
    expect(data.auditAlerts[0]).toMatchObject({ action: 'access.denied', actorRole: 'doctor' });
    expect(Object.keys(data.auditAlerts[0]).sort()).toEqual([
      'action',
      'actorName',
      'actorRole',
      'at',
      'id',
      'resourceNumber',
      'resourceType',
    ]);
    expect(data.ai).toMatchObject({ calls: 0, today: { limit: expect.any(Number) } });
  });
});
