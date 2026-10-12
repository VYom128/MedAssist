import express from 'express';
import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { csvCell } from '../src/modules/reports/csv.js';
import { createExportLimiter } from '../src/middlewares/rateLimiters.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { paiseToRupeeString } from '../src/utils/money.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { at, createDoctor, createPatient, insertAppointment } from './helpers/fixtures.js';
import { api, expectErrorShape, serve } from './helpers/testApp.js';

/**
 * Reports (spec §7.18, Phase 10): JSON { rows, totals, meta } and streamed CSV (BOM, clinic
 * dates, rupees from paise, injection-safe cells), the 366-day limit, roles, the export audit
 * entry and the export rate limit.
 */

let admin: LoggedIn;
let reception: LoggedIn;
beforeAll(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Invoice.init(), Payment.init()]);
  admin = await loginAs('admin');
  reception = await loginAs('receptionist');
  const doctor = (await createDoctor({ firstName: 'Asha', lastName: 'Mehta' })).id;
  const patient = (await createPatient()).id;
  await insertAppointment({
    patient,
    doctor,
    startAt: at('2026-03-31', '23:50'),
    status: 'completed',
  });
  await insertAppointment({
    patient,
    doctor,
    startAt: at('2026-04-01', '00:05'),
    status: 'no_show',
  });
  const invoiceId = new Types.ObjectId();
  await Invoice.collection.insertOne({
    _id: invoiceId,
    patient: new Types.ObjectId(patient),
    kind: 'manual',
    status: 'paid',
    invoiceNumber: 'INV-2026-000001',
    issuedAt: at('2026-03-31', '10:00'),
    totalPaise: 125_050,
    balancePaise: 0,
    items: [
      {
        kind: 'other',
        description: '=HYPERLINK("http://evil")',
        quantity: 1,
        lineTotalPaise: 125_050,
      },
    ],
  });
  await Payment.collection.insertMany([
    {
      paymentNumber: 'PAY-2026-000001',
      invoice: invoiceId,
      patient: new Types.ObjectId(patient),
      amountPaise: 125_050,
      method: 'upi',
      kind: 'payment',
      receivedBy: admin.user._id,
      receivedAt: at('2026-03-31', '23:30'),
    },
    {
      paymentNumber: 'PAY-2026-000002',
      invoice: invoiceId,
      patient: new Types.ObjectId(patient),
      amountPaise: -5_000,
      method: 'upi',
      kind: 'refund',
      receivedBy: admin.user._id,
      receivedAt: at('2026-03-31', '23:40'),
    },
  ]);
});

const get = (who: LoggedIn, path: string) => api().get(`/api/v1${path}`).set(who.auth);
const text = (who: LoggedIn, path: string) =>
  get(who, path)
    .buffer(true)
    .parse((res, cb) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => cb(null, body));
    });

describe('JSON reports', () => {
  it('appointments per clinic day: 23:50 IST counts on the 31st, 00:05 on the 1st', async () => {
    const res = await get(admin, '/reports/appointments?from=2026-03-31&to=2026-04-01&groupBy=day');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r: { key: string; total: number }) => [r.key, r.total])).toEqual(
      [
        ['2026-03-31', 1],
        ['2026-04-01', 1],
      ],
    );
    expect(res.body.data.totals).toMatchObject({ total: 2, completed: 1, no_show: 1 });
    expect(res.body.meta).toMatchObject({
      type: 'appointments',
      from: '2026-03-31',
      to: '2026-04-01',
      groupBy: 'day',
      timezone: 'Asia/Kolkata',
    });
  });

  it('revenue per method in paise, with outstanding', async () => {
    const res = await get(admin, '/reports/revenue?from=2026-03-01&to=2026-03-31&groupBy=method');
    expect(res.body.data.rows.find((r: { key: string }) => r.key === 'upi')).toMatchObject({
      paymentsPaise: 125_050,
      refundsPaise: 5_000,
      netPaise: 120_050,
    });
    expect(res.body.data.totals).toMatchObject({ netPaise: 120_050, outstandingPaise: 0 });
  });

  it('at most 366 days → 422; "to" before "from" → 400', async () => {
    const long = await get(admin, '/reports/appointments?from=2025-01-01&to=2026-01-02');
    expect(long.status).toBe(422);
    expectErrorShape(long.body, 'VALIDATION_ERROR');
    expect((await get(admin, '/reports/appointments?from=2025-01-01&to=2026-01-01')).status).toBe(
      200,
    );
    const backwards = await get(admin, '/reports/appointments?from=2026-03-02&to=2026-03-01');
    expect(backwards.status).toBe(400);
  });

  it('revenue and utilisation are admin only; reception gets the operational ones', async () => {
    const q = '?from=2026-03-01&to=2026-03-31';
    expect((await get(reception, `/reports/revenue${q}`)).status).toBe(403);
    expect((await get(reception, `/reports/doctor-utilisation${q}`)).status).toBe(403);
    expect((await get(reception, `/reports/appointments${q}`)).status).toBe(200);
    expect((await get(reception, `/reports/no-shows${q}`)).status).toBe(200);
    const lab = await loginAs('labtech');
    expect((await get(lab, `/reports/lab-turnaround${q}`)).status).toBe(200);
    expect((await get(lab, `/reports/appointments${q}`)).status).toBe(403);
  });
});

describe('CSV export', () => {
  it('streams a BOM, clinic dates, rupees from paise and a totals row – audited without data', async () => {
    const res = await text(
      admin,
      '/reports/revenue?from=2026-03-30&to=2026-03-31&groupBy=day&format=csv',
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="medassist-revenue-2026-03-30-2026-03-31.csv"',
    );
    const body = res.body as string;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Date,Invoices issued,Billed (₹),Payments (₹),Refunds (₹),Net collected (₹)',
    );
    expect(lines[1]).toBe('2026-03-30,0,0.00,0.00,0.00,0.00');
    expect(lines[2]).toBe('2026-03-31,1,1250.50,1250.50,50.00,1200.50');
    expect(lines[3]).toBe('Total,1,1250.50,1250.50,50.00,1200.50');

    const [entry] = await auditEntries('report.export');
    expect(entry).toMatchObject({
      actor: { role: 'admin' },
      metadata: { report: 'revenue', from: '2026-03-30', to: '2026-03-31', format: 'csv', rows: 2 },
    });
    expect(JSON.stringify(entry)).not.toMatch(/1250|125050/);
  });

  it('protects against CSV injection', async () => {
    const res = await text(
      admin,
      '/reports/revenue?from=2026-03-01&to=2026-03-31&groupBy=service&format=csv',
    );
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-2500, 'money')).toBe('-25.00'); // numbers stay numbers
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(new Date('2026-03-31T18:20:00Z'), 'datetime', 'Asia/Kolkata')).toBe(
      '2026-03-31 23:50',
    );
    expect(paiseToRupeeString(5)).toBe('0.05');
  });

  it('JSON views are not audited', async () => {
    const before = (await auditEntries('report.export')).length;
    await get(admin, '/reports/no-shows?from=2026-03-01&to=2026-03-31');
    expect((await auditEntries('report.export')).length).toBe(before);
  });

  it('exports are rate limited per user (CSV only)', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'u1' } as never;
      next();
    });
    app.get('/x', createExportLimiter({ limit: 1 }), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    const call = await serve(app);
    expect((await call().get('/x?format=csv')).status).toBe(200);
    const limited = await call().get('/x?format=csv');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect((await call().get('/x?format=json')).status).toBe(200);
  });
});
