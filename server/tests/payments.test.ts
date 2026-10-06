import { Types } from 'mongoose';
import { Invoice } from '../src/modules/invoices/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { clinicToday, startOfClinicDay, addDaysToDate } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { createPatient, loginAsPatient, setSettings } from './helpers/fixtures.js';
import { isPdf, pdfText } from './helpers/pdf.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Payments, refunds, the day close summary and invoice/receipt PDFs (spec §4.9, §6.22, §8.9,
 * §12.3; Phase 7 decisions).
 */

let emails: ReturnType<typeof captureEmails>;
let reception: LoggedIn;
let admin: LoggedIn;

beforeAll(async () => {
  await Promise.all([Invoice.init(), Payment.init()]);
});

beforeEach(async () => {
  await resetDb();
  await setSettings({ 'billing.defaultTaxRateBps': 0 });
  emails = captureEmails();
  [reception, admin] = await Promise.all([loginAs('receptionist'), loginAs('admin')]);
});
afterEach(() => emails.restore());

const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
  api().post(`/api/v1${path}`).set(auth).send(body);
const get = (path: string, auth: { Authorization: string }) =>
  api().get(`/api/v1${path}`).set(auth);
const binary = (path: string, auth: { Authorization: string }) =>
  api()
    .get(`/api/v1${path}`)
    .set(auth)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

/** An issued invoice of `totalPaise` (one 'other' line, no tax) for a new patient or `patientId`. */
async function issued(totalPaise: number, patientId?: string) {
  const pid = patientId ?? (await createPatient({ email: 'meera@example.com' })).id;
  const created = await post('/invoices', reception.auth, {
    patientId: pid,
    items: [{ kind: 'other', description: 'Physiotherapy session', unitPricePaise: totalPaise }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const res = await post(`/invoices/${created.body.data.id}/issue`, reception.auth, {
    expectedVersion: 0,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as { id: string; invoiceNumber: string; patient: { id: string } };
}

const pay = (invoiceId: string, body: object, as = reception) =>
  post(`/invoices/${invoiceId}/payments`, as.auth, body);

async function paid(invoiceId: string, amountPaise: number, method = 'cash', reference?: string) {
  const res = await pay(invoiceId, { amountPaise, method, ...(reference ? { reference } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as {
    payment: { id: string; paymentNumber: string };
    invoice: { status: string; amountPaidPaise: number; balancePaise: number };
  };
}

describe('POST /invoices/:id/payments', () => {
  it('records part payments until the invoice is paid', async () => {
    const inv = await issued(100_000);
    const first = await paid(inv.id, 40_000, 'upi', 'UPI-4421-8812-7731');
    const year = clinicToday('Asia/Kolkata').slice(0, 4);
    expect(first.payment).toMatchObject({
      paymentNumber: `PAY-${year}-000001`,
      kind: 'payment',
      amountPaise: 40_000,
      method: 'upi',
      reference: 'UPI-4421-8812-7731',
      refundablePaise: 40_000,
    });
    expect(first.invoice).toMatchObject({
      status: 'partially_paid',
      amountPaidPaise: 40_000,
      balancePaise: 60_000,
    });
    const second = await paid(inv.id, 60_000);
    expect(second.invoice).toMatchObject({
      status: 'paid',
      amountPaidPaise: 100_000,
      balancePaise: 0,
    });
    const stored = await Invoice.findById(inv.id).lean();
    expect(stored!.statusHistory.map((h) => h.status)).toEqual([
      'draft',
      'issued',
      'partially_paid',
      'paid',
    ]);

    const [entry] = await auditEntries('payment.create');
    expect(entry).toMatchObject({
      resource: { type: 'payment', number: `PAY-${year}-000001` },
      metadata: { amountPaise: 40_000, method: 'upi', referenceGiven: true },
    });
    expect(JSON.stringify(entry)).not.toContain('UPI-4421');

    // The patient is told a receipt is available – no amounts.
    await vi.waitFor(() => expect(emails.sent.length).toBeGreaterThanOrEqual(3));
    const receiptMails = emails.sent.filter((m) => /Payment received/.test(JSON.stringify(m)));
    expect(receiptMails).toHaveLength(2);
    for (const m of receiptMails) {
      expect(JSON.stringify(m)).toContain(inv.invoiceNumber);
      expect(JSON.stringify(m)).not.toMatch(/₹|Rs\.?|40,000|400\.00|60,000|600\.00/);
    }
  });

  it('cannot exceed the balance; a paid, draft or void invoice cannot be paid', async () => {
    const inv = await issued(10_000);
    const over = await pay(inv.id, { amountPaise: 10_001, method: 'cash' });
    expect(over.status).toBe(422);
    expect(expectErrorShape(over.body, 'PAYMENT_EXCEEDS_BALANCE').error.details).toEqual({
      balancePaise: 10_000,
    });
    await paid(inv.id, 10_000);
    const again = await pay(inv.id, { amountPaise: 1, method: 'cash' });
    expect(again.status).toBe(422);
    expectErrorShape(again.body, 'PAYMENT_EXCEEDS_BALANCE');

    const patient = await createPatient();
    const draft = await post('/invoices', reception.auth, {
      patientId: patient.id,
      items: [{ kind: 'other', description: 'X', unitPricePaise: 100 }],
    });
    const onDraft = await pay(draft.body.data.id, { amountPaise: 100, method: 'cash' });
    expect(onDraft.status).toBe(409);
    expectErrorShape(onDraft.body, 'INVALID_STATUS_TRANSITION');
    await post(`/invoices/${draft.body.data.id}/void`, reception.auth, { reason: 'Duplicate' });
    const onVoid = await pay(draft.body.data.id, { amountPaise: 100, method: 'cash' });
    expect(onVoid.status).toBe(409);
  });

  it('card, UPI and insurance need a reference; cash and other do not', async () => {
    const inv = await issued(100_000);
    for (const method of ['card', 'upi', 'insurance']) {
      const res = await pay(inv.id, { amountPaise: 100, method, reference: '  ' });
      expect(res.status).toBe(400);
      expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual([
        expect.objectContaining({ field: 'body.reference' }),
      ]);
    }
    await paid(inv.id, 100, 'card', 'SLIP 00912');
    await paid(inv.id, 100, 'insurance', 'CLAIM-77');
    await paid(inv.id, 100, 'cash');
    await paid(inv.id, 100, 'other');
    for (const body of [
      { amountPaise: 0, method: 'cash' },
      { amountPaise: 10.5, method: 'cash' },
      { amountPaise: 100, method: 'cheque' },
      { amountPaise: 100, method: 'cash', status: 'paid' },
    ]) {
      expect((await pay(inv.id, body)).status).toBe(400);
    }
  });

  it('a method turned off in the settings is refused', async () => {
    await setSettings({ 'billing.paymentMethods': ['cash', 'upi'] });
    const inv = await issued(1000);
    const res = await pay(inv.id, { amountPaise: 100, method: 'card', reference: '1234' });
    expect(res.status).toBe(422);
  });

  it('10 parallel payments never exceed the total; the others fail cleanly', async () => {
    const inv = await issued(10_000);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(inv.id, { amountPaise: 3000, method: 'cash' })),
    );
    for (const r of results) {
      expect([201, 409, 422], JSON.stringify(r.body)).toContain(r.status);
      if (r.status !== 201) {
        expect(['CONFLICT', 'PAYMENT_EXCEEDS_BALANCE']).toContain(r.body.error.code);
      }
    }
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBeGreaterThanOrEqual(1);
    expect(ok).toBeLessThanOrEqual(3);
    const payments = await Payment.find({ invoice: inv.id }).lean();
    const sum = payments.reduce((s, p) => s + p.amountPaise, 0);
    expect(payments).toHaveLength(ok);
    expect(sum).toBeLessThanOrEqual(10_000);
    const stored = await Invoice.findById(inv.id).lean();
    expect(stored).toMatchObject({ amountPaidPaise: sum, balancePaise: 10_000 - sum });
  });

  it('receptionists only: admins, doctors and patients cannot record payments', async () => {
    const inv = await issued(1000);
    expect((await pay(inv.id, { amountPaise: 100, method: 'cash' }, admin)).status).toBe(403);
    const doctor = await loginAs('doctor');
    expect((await pay(inv.id, { amountPaise: 100, method: 'cash' }, doctor)).status).toBe(403);
  });
});

describe('POST /payments/:id/refund', () => {
  it('refunds in parts up to what is left of the payment; the status follows', async () => {
    const inv = await issued(10_000);
    const p1 = await paid(inv.id, 6000);
    const p2 = await paid(inv.id, 4000);

    const r1 = await post(`/payments/${p1.payment.id}/refund`, reception.auth, {
      amountPaise: 2500,
      reason: 'Test not done',
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r1.body.data.refund).toMatchObject({
      kind: 'refund',
      amountPaise: -2500,
      method: 'cash',
      refundOf: p1.payment.id,
      reason: 'Test not done',
    });
    expect(r1.body.data.invoice).toMatchObject({
      status: 'partially_paid',
      amountPaidPaise: 7500,
      balancePaise: 2500,
    });

    const tooMuch = await post(`/payments/${p1.payment.id}/refund`, admin.auth, {
      amountPaise: 3501,
      reason: 'Goodwill refund',
    });
    expect(tooMuch.status).toBe(422);
    expect(expectErrorShape(tooMuch.body, 'REFUND_EXCEEDS_PAYMENT').error.details).toEqual({
      refundablePaise: 3500,
    });

    // The rest of both payments → nothing paid → issued; then it can be voided.
    await post(`/payments/${p1.payment.id}/refund`, admin.auth, {
      amountPaise: 3500,
      reason: 'Goodwill refund',
    });
    const last = await post(`/payments/${p2.payment.id}/refund`, reception.auth, {
      amountPaise: 4000,
      reason: 'Billed the wrong patient',
    });
    expect(last.body.data.invoice).toMatchObject({
      status: 'issued',
      amountPaidPaise: 0,
      balancePaise: 10_000,
    });
    const full = await post(`/payments/${p1.payment.id}/refund`, admin.auth, {
      amountPaise: 1,
      reason: 'One more time',
    });
    expect(full.status).toBe(422);
    expect(full.body.message).toMatch(/already been refunded in full/);

    const voided = await post(`/invoices/${inv.id}/void`, reception.auth, {
      reason: 'Wrong patient',
    });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe('void');

    const list = await get(`/invoices/${inv.id}/payments`, reception.auth);
    expect(list.body.data.map((p: { amountPaise: number }) => p.amountPaise)).toEqual([
      6000, 4000, -2500, -3500, -4000,
    ]);
    expect(list.body.data[0]).toMatchObject({ refundedPaise: 6000, refundablePaise: 0 });
    const entries = await auditEntries('payment.refund');
    expect(entries).toHaveLength(3);
    expect(JSON.stringify(entries)).not.toContain('Goodwill');
  });

  it('paid → partially_paid on a refund; a refund cannot be refunded', async () => {
    const inv = await issued(5000);
    const p = await paid(inv.id, 5000);
    const r = await post(`/payments/${p.payment.id}/refund`, reception.auth, {
      amountPaise: 1000,
      reason: 'Overcharged for dressing',
    });
    expect(r.body.data.invoice).toMatchObject({ status: 'partially_paid', balancePaise: 1000 });
    const ofRefund = await post(`/payments/${r.body.data.refund.id}/refund`, reception.auth, {
      amountPaise: 100,
      reason: 'Refund the refund',
    });
    expect(ofRefund.status).toBe(422);
    // The balance reopened by a refund can be paid again.
    expect((await pay(inv.id, { amountPaise: 1000, method: 'cash' })).status).toBe(201);
  });

  it('needs a reason of 10+ characters; parallel refunds never over-refund', async () => {
    const inv = await issued(10_000);
    const p = await paid(inv.id, 10_000);
    const short = await post(`/payments/${p.payment.id}/refund`, reception.auth, {
      amountPaise: 100,
      reason: 'Too short',
    });
    expect(short.status).toBe(400);

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(`/payments/${p.payment.id}/refund`, reception.auth, {
          amountPaise: 4000,
          reason: 'Parallel refund test',
        }),
      ),
    );
    for (const r of results) expect([201, 409, 422]).toContain(r.status);
    const refunds = await Payment.find({ refundOf: p.payment.id }).lean();
    const refunded = -refunds.reduce((s, x) => s + x.amountPaise, 0);
    expect(refunded).toBeLessThanOrEqual(10_000);
    const stored = await Invoice.findById(inv.id).lean();
    expect(stored!.amountPaidPaise).toBe(10_000 - refunded);
  });

  it('an unknown payment is 404', async () => {
    const res = await post(`/payments/${new Types.ObjectId()}/refund`, reception.auth, {
      amountPaise: 100,
      reason: 'Does not exist',
    });
    expect(res.status).toBe(404);
  });
});

describe('payments are append-only', () => {
  it('refuses every update and delete', async () => {
    const inv = await issued(1000);
    const p = await paid(inv.id, 1000);
    const doc = (await Payment.findById(p.payment.id))!;
    const attempts = [
      () => Payment.updateOne({ _id: p.payment.id }, { $set: { amountPaise: 1 } }),
      () => Payment.findOneAndUpdate({ _id: p.payment.id }, { $set: { method: 'upi' } }),
      () => Payment.deleteOne({ _id: p.payment.id }),
      () => Payment.deleteMany({}),
      () => doc.deleteOne(),
      async () => {
        doc.amountPaise = 5;
        await doc.save();
      },
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    }
    expect((await Payment.findById(p.payment.id).lean())!.amountPaise).toBe(1000);
  });

  it('a refund must be negative, linked and explained (model rule)', async () => {
    const base = {
      paymentNumber: 'PAY-1999-000001',
      invoice: new Types.ObjectId(),
      patient: new Types.ObjectId(),
      method: 'cash',
      receivedBy: new Types.ObjectId(),
      receivedAt: new Date(),
    };
    await expect(Payment.create({ ...base, kind: 'refund', amountPaise: 100 })).rejects.toThrow();
    await expect(Payment.create({ ...base, kind: 'payment', amountPaise: -100 })).rejects.toThrow();
    await expect(Payment.create({ ...base, kind: 'payment', amountPaise: 0 })).rejects.toThrow();
  });
});

describe('who reads payments', () => {
  it('the patient sees their own with masked references; others → 404', async () => {
    const me = await loginAsPatient();
    const mine = await issued(5000, me.patientId);
    await paid(mine.id, 5000, 'card', 'SLIP-99887766');
    const theirs = await issued(5000);
    const p = await paid(theirs.id, 5000);

    const own = await get(`/invoices/${mine.id}/payments`, me.auth);
    expect(own.status).toBe(200);
    expect(own.body.data[0]).toMatchObject({ reference: '••••7766' });
    expect(own.body.data[0]).not.toHaveProperty('receivedByName');
    expect((await get(`/invoices/${theirs.id}/payments`, me.auth)).status).toBe(404);
    expect((await binary(`/payments/${p.payment.id}/receipt.pdf`, me.auth)).status).toBe(404);
    expect((await binary(`/invoices/${theirs.id}/pdf`, me.auth)).status).toBe(404);

    const staff = await get(`/invoices/${mine.id}/payments`, reception.auth);
    expect(staff.body.data[0]).toMatchObject({
      reference: 'SLIP-99887766',
      receivedByName: expect.any(String),
    });
  });
});

describe('GET /payments/summary (day close)', () => {
  it('sums payments and refunds per method for the clinic day only', async () => {
    const tz = 'Asia/Kolkata';
    const today = clinicToday(tz);
    const start = startOfClinicDay(today, tz).getTime();
    const tomorrow = startOfClinicDay(addDaysToDate(today, 1), tz).getTime();
    const patient = await createPatient({ firstName: 'Rahul', lastName: 'Verma' });
    const inv = await Invoice.create({
      kind: 'manual',
      patient: patient.id,
      status: 'issued',
      invoiceNumber: 'INV-1999-000777',
    });
    const user = reception.user._id;
    let n = 0;
    const row = (amountPaise: number, method: string, at: number, extra: object = {}) => {
      n += 1;
      return {
        paymentNumber: `PAY-1999-${String(n).padStart(6, '0')}`,
        invoice: inv._id,
        patient: patient.id,
        amountPaise,
        method,
        kind: amountPaise > 0 ? 'payment' : 'refund',
        receivedBy: user,
        receivedAt: new Date(at),
        ...extra,
      };
    };
    const cash1 = await Payment.create(row(1000, 'cash', start)); // 00:00 – today
    await Payment.create(row(500, 'cash', start + 3_600_000));
    await Payment.create(
      row(-300, 'cash', start + 7_200_000, { refundOf: cash1._id, reason: 'Partial refund' }),
    );
    await Payment.create(row(2000, 'upi', tomorrow - 1)); // 23:59:59.999 – today
    await Payment.create(row(9999, 'card', start - 1)); // yesterday
    await Payment.create(row(8888, 'card', tomorrow)); // tomorrow 00:00

    const res = await get(`/payments/summary?date=${today}`, reception.auth);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.date).toBe(today);
    const byMethod = Object.fromEntries(
      data.byMethod.map((m: { method: string }) => [m.method, m]),
    );
    expect(byMethod.cash).toEqual({
      method: 'cash',
      paymentCount: 2,
      collectedPaise: 1500,
      refundCount: 1,
      refundedPaise: 300,
      netPaise: 1200,
    });
    expect(byMethod.upi).toMatchObject({ paymentCount: 1, collectedPaise: 2000, netPaise: 2000 });
    expect(byMethod.card).toMatchObject({ paymentCount: 0, netPaise: 0 });
    expect(data.totals).toEqual({
      paymentCount: 3,
      collectedPaise: 3500,
      refundCount: 1,
      refundedPaise: 300,
      netPaise: 3200,
    });
    expect(data.payments.map((p: { time: string }) => p.time)).toEqual([
      '00:00',
      '01:00',
      '02:00',
      '23:59',
    ]);
    expect(data.payments[0]).toMatchObject({
      invoiceNumber: 'INV-1999-000777',
      patientName: 'Rahul V.',
      receivedByName: expect.any(String),
    });

    // Default date = today; admins too; patients and doctors not.
    expect((await get('/payments/summary', admin.auth)).body.data.totals.netPaise).toBe(3200);
    const me = await loginAsPatient();
    expect((await get('/payments/summary', me.auth)).status).toBe(403);
  });
});

describe('PDFs', () => {
  it('invoice PDF: number, lines, ₹ amounts, words, payments, balance; inline or download', async () => {
    await setSettings({
      gstin: '27AAACM1234A1Z5',
      'billing.invoiceFooter': 'Thank you for visiting.',
      'billing.taxLabel': 'GST',
    });
    const patient = await createPatient({ firstName: 'Meera', lastName: 'Iyer' });
    const inv = await issued(125_050, patient.id);
    await paid(inv.id, 25_050, 'upi', 'UPI-0000-1111-2222');

    const res = await binary(`/invoices/${inv.id}/pdf`, reception.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="INV-\d{4}-\d{6}\.pdf"$/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(isPdf(res.body)).toBe(true);
    const text = pdfText(res.body);
    for (const expected of [
      'TAX INVOICE',
      'GSTIN 27AAACM1234A1Z5',
      inv.invoiceNumber,
      'Meera Iyer',
      'Physiotherapy session',
      '₹1,250.50',
      'Rupees One Thousand Two Hundred Fifty and Fifty Paise Only',
      '₹250.50',
      '••••2222',
      'Balance due',
      '₹1,000.00',
      'Thank you for visiting.',
      'Computer-generated invoice',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('UPI-0000-1111-2222');
    expect(text).not.toContain('VOID');

    const download = await binary(`/invoices/${inv.id}/pdf?download=true`, reception.auth);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    const [entry] = await auditEntries('invoice.download');
    expect(entry).toMatchObject({ resource: { number: inv.invoiceNumber } });
  });

  it('"INVOICE" without a GSTIN; VOID when voided; drafts are not printed', async () => {
    const inv = await issued(1000);
    await post(`/invoices/${inv.id}/void`, reception.auth, { reason: 'Wrong patient' });
    const text = pdfText((await binary(`/invoices/${inv.id}/pdf`, admin.auth)).body);
    expect(text).toContain('INVOICE');
    expect(text).not.toContain('TAX INVOICE');
    expect(text).toContain('VOID');
    expect(text).toContain('Nothing is due');

    const patient = await createPatient();
    const draft = await post('/invoices', reception.auth, { patientId: patient.id, items: [] });
    expect((await binary(`/invoices/${draft.body.data.id}/pdf`, reception.auth)).status).toBe(422);
  });

  it('receipts: amount in words, last 4 of the reference, REFUND for refunds; the patient gets their own', async () => {
    const me = await loginAsPatient({ firstName: 'Kiran', lastName: 'Rao' });
    const inv = await issued(50_000, me.patientId);
    const p = await paid(inv.id, 50_000, 'card', 'SLIP-12345678');

    const receipt = await binary(`/payments/${p.payment.id}/receipt.pdf`, me.auth);
    expect(receipt.status).toBe(200);
    const text = pdfText(receipt.body);
    for (const expected of [
      'PAYMENT RECEIPT',
      p.payment.paymentNumber,
      'Kiran Rao',
      inv.invoiceNumber,
      '₹500.00',
      'Rupees Five Hundred Only',
      '••••5678',
      'Card',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('SLIP-1234');
    expect(text).not.toContain('REFUND');

    const r = await post(`/payments/${p.payment.id}/refund`, reception.auth, {
      amountPaise: 12_500,
      reason: 'Physio session cancelled',
    });
    const refundPdf = await binary(`/payments/${r.body.data.refund.id}/receipt.pdf`, me.auth);
    const refundText = pdfText(refundPdf.body);
    expect(refundText).toContain('REFUND');
    expect(refundText).toContain('₹125.00');
    expect(refundText).toContain('Rupees One Hundred Twenty Five Only');
    expect(refundText).toContain(p.payment.paymentNumber);
    expect(await auditEntries('payment.receipt_download')).toHaveLength(2);
  });
});
