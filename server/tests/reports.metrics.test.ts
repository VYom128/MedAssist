import { Types } from 'mongoose';
import { AiInteraction } from '../src/modules/aiInteractions/model.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { DoctorLeave } from '../src/modules/leaves/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Payment } from '../src/modules/payments/model.js';
import {
  aiUsage,
  appointmentsByStatus,
  appointmentsGrouped,
  billed,
  clinicRange,
  collectedRevenue,
  doctorUtilisation,
  labTurnaround,
  newPatients,
  noShowRate,
  noShowsByDoctor,
  outstanding,
  percentile,
} from '../src/modules/reports/metrics/index.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { calendarDate } from '../src/utils/dates.js';
import { resetDb } from './helpers/auth.js';
import { at, createDoctor, createPatient, insertAppointment } from './helpers/fixtures.js';

/**
 * The shared metrics (Phase 10) against a small fixed dataset with hand-calculated answers – in
 * the default clinic zone (Asia/Kolkata, UTC+05:30), so 31 Mar 23:50 IST is in March although it
 * is 18:20Z, and 1 Apr 00:05 IST is in April although it is still 31 Mar in UTC.
 */

const TZ = 'Asia/Kolkata';
const MARCH = clinicRange('2026-03-01', '2026-03-31', TZ);
const oid = () => new Types.ObjectId();

let d1: string;
let d2: string;
let patient: string;

beforeAll(async () => {
  await resetDb();
  d1 = (await createDoctor({ firstName: 'Asha', lastName: 'Mehta' })).id;
  d2 = (await createDoctor({ firstName: 'Ravi', lastName: 'Iyer' })).id;
  patient = (await createPatient()).id;

  // Appointments: 3 completed, 1 no-show, 1 cancelled inside March; 2 just outside.
  const appt = (doctor: string, date: string, time: string, status: string, minutes = 15) =>
    insertAppointment({
      patient,
      doctor,
      startAt: at(date, time),
      status,
      minutes,
      isSlotActive: false,
    });
  await appt(d1, '2026-03-02', '10:00', 'completed');
  await appt(d1, '2026-03-02', '10:15', 'no_show');
  await appt(d1, '2026-03-03', '10:00', 'cancelled');
  await appt(d2, '2026-03-03', '11:00', 'completed', 30);
  await appt(d1, '2026-03-31', '23:50', 'completed'); // in March (IST)
  await appt(d1, '2026-04-01', '00:05', 'completed'); // April in IST, March in UTC
  await appt(d1, '2026-02-28', '23:59', 'completed');

  // Payments (refunds negative): March net 1,000 + 500 − 200 = 1,300.
  const inv = oid();
  const pay = (amountPaise: number, method: string, date: string, time: string) => ({
    paymentNumber: `PAY-T-${Math.random()}`,
    invoice: inv,
    patient: new Types.ObjectId(patient),
    amountPaise,
    method,
    kind: amountPaise > 0 ? 'payment' : 'refund',
    receivedBy: oid(),
    receivedAt: at(date, time),
  });
  await Payment.collection.insertMany([
    pay(100_000, 'cash', '2026-03-05', '12:00'),
    pay(50_000, 'upi', '2026-03-31', '23:30'),
    pay(-20_000, 'cash', '2026-03-10', '09:00'),
    pay(70_000, 'cash', '2026-04-01', '00:10'),
  ]);

  // Invoices: issued + paid count; void and draft never; April's is outstanding only.
  const line = (kind: string, description: string, lineTotalPaise: number) => ({
    _id: oid(),
    kind,
    description,
    quantity: 1,
    lineTotalPaise,
  });
  const invoice = (
    status: string,
    totalPaise: number,
    balancePaise: number,
    issuedAt: Date | null,
    items: object[],
  ) => ({
    patient: new Types.ObjectId(patient),
    kind: 'manual',
    status,
    totalPaise,
    balancePaise,
    ...(issuedAt ? { issuedAt, invoiceNumber: `INV-T-${Math.random()}` } : {}),
    items,
  });
  await Invoice.collection.insertMany([
    invoice('issued', 150_000, 50_000, at('2026-03-05', '10:00'), [
      line('consultation', 'Consultation', 100_000),
      line('lab_test', 'CBC', 50_000),
    ]),
    invoice('paid', 50_000, 0, at('2026-03-31', '23:00'), [
      line('consultation', 'Consultation', 50_000),
    ]),
    invoice('void', 999_900, 0, at('2026-03-06', '10:00'), [line('other', 'Mistake', 999_900)]),
    invoice('draft', 10_000, 10_000, null, [line('other', 'Draft line', 10_000)]),
    invoice('partially_paid', 80_000, 30_000, at('2026-04-01', '00:30'), [
      line('procedure', 'Dressing', 80_000),
    ]),
  ]);

  // New patients: two in March (one at 23:59 IST on the 31st), one on 1 April IST.
  const [p1, p2, p3] = await Promise.all([createPatient(), createPatient(), createPatient()]);
  await Patient.collection.updateOne(
    { _id: p1.patient._id },
    { $set: { createdAt: at('2026-03-10', '10:00') } },
  );
  await Patient.collection.updateOne(
    { _id: p2.patient._id },
    { $set: { createdAt: at('2026-03-31', '23:59') } },
  );
  await Patient.collection.updateOne(
    { _id: p3.patient._id },
    { $set: { createdAt: at('2026-04-01', '00:01') } },
  );
  await Patient.collection.updateOne(
    { _id: new Types.ObjectId(patient) },
    { $set: { createdAt: at('2026-05-01', '10:00') } },
  );
  await Patient.collection.updateMany(
    { createdAt: { $gt: new Date('2026-06-01') } },
    { $set: { createdAt: at('2026-05-02', '10:00') } },
  );

  // Schedules from January: d1 09:00–13:00, d2 09:00–10:00, every day; d1 on leave 3 Mar 10–12.
  const schedule = (doctor: string, start: string, end: string) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      doctor: new Types.ObjectId(doctor),
      weekday,
      sessions: [{ start, end }],
      effectiveFrom: calendarDate('2026-01-01'),
    }));
  await DoctorSchedule.deleteMany({});
  await DoctorSchedule.insertMany([
    ...schedule(d1, '09:00', '13:00'),
    ...schedule(d2, '09:00', '10:00'),
  ]);
  await DoctorLeave.create({
    doctor: d1,
    startAt: at('2026-03-03', '10:00'),
    endAt: at('2026-03-03', '12:00'),
  });
  await DoctorLeave.create({
    doctor: d1,
    startAt: at('2026-03-02', '09:00'),
    endAt: at('2026-03-02', '13:00'),
    isCancelled: true,
  });

  // Lab orders released in March: CBC 4 h, 10 h (over its 6 h), 1 h; LFT 1 h; one in April.
  const test = (code: string, turnaroundHours: number, status = 'verified') => ({
    _id: oid(),
    test: oid(),
    status,
    testSnapshot: { code, name: code, pricePaise: 100, turnaroundHours },
  });
  const order = (orderedAt: Date, releasedAt: Date, items: object[]) => ({
    patient: new Types.ObjectId(patient),
    orderedBy: new Types.ObjectId(d1),
    status: 'released',
    orderedAt,
    releasedAt,
    items,
  });
  await LabOrder.collection.insertMany([
    order(at('2026-03-04', '10:00'), at('2026-03-04', '14:00'), [
      test('CBC', 6),
      test('CRP', 6, 'cancelled'),
    ]),
    order(at('2026-03-05', '10:00'), at('2026-03-05', '20:00'), [test('CBC', 6)]),
    order(at('2026-03-06', '08:00'), at('2026-03-06', '09:00'), [test('CBC', 6), test('LFT', 24)]),
    order(at('2026-03-31', '20:00'), at('2026-04-01', '00:30'), [test('CBC', 6)]),
  ]);

  // AI: one call with a failed first attempt, one blocked call; one in April.
  const ai = (attempt: number, status: string, createdAt: Date, callId: string) => ({
    callId,
    attempt,
    feature: 'patient_explanation',
    provider: 'mock',
    promptVersion: 't.v1',
    inputHash: 'a'.repeat(64),
    status,
    usage: { inputTokens: 100, outputTokens: 50 },
    createdAt,
  });
  await AiInteraction.collection.insertMany([
    ai(1, 'failed', at('2026-03-07', '10:00'), 'c1'),
    ai(2, 'success', at('2026-03-07', '10:00'), 'c1'),
    ai(1, 'blocked', at('2026-03-08', '10:00'), 'c2'),
    ai(1, 'success', at('2026-04-01', '00:15'), 'c3'),
  ]);
}, 60_000);

describe('appointment metrics', () => {
  it('counts March by status in the clinic timezone', async () => {
    expect(await appointmentsByStatus(MARCH)).toEqual({
      scheduled: 0,
      checked_in: 0,
      in_consultation: 0,
      completed: 3,
      cancelled: 1,
      no_show: 1,
      total: 5,
    });
    expect((await appointmentsByStatus(MARCH, { doctorId: d2 })).total).toBe(1);
  });

  it('groups by clinic day and by doctor', async () => {
    const days = await appointmentsGrouped(MARCH, 'day');
    expect(days.map((d) => [d.key, d.total])).toEqual([
      ['2026-03-02', 2],
      ['2026-03-03', 2],
      ['2026-03-31', 1],
    ]);
    const doctors = await appointmentsGrouped(MARCH, 'doctor');
    expect(doctors.map((d) => [d.label, d.total, d.completed])).toEqual([
      ['Dr Asha Mehta', 4, 2],
      ['Dr Ravi Iyer', 1, 1],
    ]);
  });

  it('no-show rate = no-shows ÷ (completed + no-shows)', async () => {
    expect(await noShowRate(MARCH)).toEqual({ completed: 3, noShow: 1, rate: 0.25 });
    expect((await noShowsByDoctor(MARCH)).map((x) => [x.label, x.rate])).toEqual([
      ['Dr Asha Mehta', 0.3333],
      ['Dr Ravi Iyer', 0],
    ]);
  });
});

describe('money metrics', () => {
  it('collected = payments − refunds by receivedAt, per method and per day', async () => {
    expect(await collectedRevenue(MARCH)).toEqual([
      { key: 'total', paymentsPaise: 150_000, refundsPaise: 20_000, netPaise: 130_000 },
    ]);
    const methods = await collectedRevenue(MARCH, 'method');
    expect(methods.find((m) => m.key === 'cash')).toEqual({
      key: 'cash',
      paymentsPaise: 100_000,
      refundsPaise: 20_000,
      netPaise: 80_000,
    });
    expect(methods.find((m) => m.key === 'upi')?.netPaise).toBe(50_000);
    expect(methods.find((m) => m.key === 'card')?.netPaise).toBe(0);
    const days = await collectedRevenue(MARCH, 'day');
    expect(days.find((d) => d.key === '2026-03-31')?.netPaise).toBe(50_000);
  });

  it('billed = issued/paid invoice totals by issuedAt (no void or draft), per item', async () => {
    expect(await billed(MARCH)).toEqual([
      { key: 'total', label: 'total', invoices: 2, quantity: 2, billedPaise: 200_000 },
    ]);
    const items = await billed(MARCH, 'service');
    expect(items.map((x) => [x.label, x.quantity, x.invoices, x.billedPaise])).toEqual([
      ['Consultation', 2, 2, 150_000],
      ['CBC', 1, 1, 50_000],
    ]);
  });

  it('outstanding = balances of issued and partially paid invoices', async () => {
    expect(await outstanding()).toEqual({ invoices: 2, balancePaise: 80_000 });
  });
});

describe('other metrics', () => {
  it('new patients by createdAt in the clinic timezone', async () => {
    expect(await newPatients(MARCH)).toBe(2);
  });

  it('utilisation = booked ÷ available minutes (leave removed, cancelled leave ignored)', async () => {
    const rows = await doctorUtilisation(clinicRange('2026-03-02', '2026-03-03', TZ));
    expect(rows).toEqual([
      {
        doctorId: d1,
        doctorName: 'Dr Asha Mehta',
        availableMinutes: 360, // 2 × 240 − 120 leave
        bookedMinutes: 15, // the completed visit; no-show and cancelled do not hold time
        utilisation: 0.0417,
      },
      {
        doctorId: d2,
        doctorName: 'Dr Ravi Iyer',
        availableMinutes: 120,
        bookedMinutes: 30,
        utilisation: 0.25,
      },
    ]);
  });

  it('lab turnaround: median, p90 and over-target per test, orderedAt → releasedAt', async () => {
    const { rows, overall } = await labTurnaround(MARCH);
    expect(rows).toEqual([
      {
        code: 'CBC',
        name: 'CBC',
        turnaroundHours: 6,
        count: 3,
        medianHours: 4,
        p90Hours: 8.8,
        averageHours: 5,
        overdue: 1,
      },
      {
        code: 'LFT',
        name: 'LFT',
        turnaroundHours: 24,
        count: 1,
        medianHours: 1,
        p90Hours: 1,
        averageHours: 1,
        overdue: 0,
      },
    ]);
    expect(overall).toEqual({
      count: 4,
      medianHours: 2.5,
      p90Hours: 8.2,
      averageHours: 4,
      overdue: 1,
    });
  });

  it('AI usage: calls, attempts, failures, blocks and tokens', async () => {
    expect(await aiUsage(MARCH)).toEqual({
      calls: 2,
      attempts: 3,
      failed: 1,
      blocked: 1,
      tokens: 450,
    });
  });

  it('percentile interpolates between ranks', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });
});

describe('indexes', () => {
  /** True when the winning plan scans an index (never the whole collection). */
  const usesIndex = (plan: unknown) => {
    const text = JSON.stringify(plan);
    return text.includes('IXSCAN') && !text.includes('COLLSCAN');
  };
  const range = { $gte: MARCH.start, $lt: MARCH.end };

  it('every metric query is supported by an index', async () => {
    await Promise.all(
      [Appointment, Payment, Invoice, LabOrder, Patient, AiInteraction, AuditLog].map((m) =>
        m.init(),
      ),
    );
    const plans = await Promise.all([
      Appointment.find({ startAt: range }).explain(),
      Payment.find({ receivedAt: range }).explain(),
      Invoice.find({
        status: { $in: ['issued', 'partially_paid', 'paid'] },
        issuedAt: range,
      }).explain(),
      Invoice.find({ status: { $in: ['issued', 'partially_paid'] } }).explain(),
      LabOrder.find({ releasedAt: range }).explain(),
      Patient.find({ createdAt: range }).explain(),
      AiInteraction.find({ createdAt: range }).explain(),
      AuditLog.find({ outcome: 'denied' }).sort({ at: -1 }).limit(10).explain(),
    ]);
    plans.forEach((p, i) => expect(usesIndex(p), `query ${i}`).toBe(true));
  });
});
