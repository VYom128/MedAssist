import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { LabTest } from '../src/modules/labTests/model.js';
import { Invoice, paymentWriteOptions } from '../src/modules/invoices/model.js';
import { createOrUpdateDraftForAppointment } from '../src/modules/invoices/sync.service.js';
import { clinicToday } from '../src/utils/dates.js';
import { withTransaction } from '../src/utils/transaction.js';
import { auditEntries, createUser, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createPatient,
  createService,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  setSettings,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Invoices API (spec §7.15, §8.9, Phase 7 decisions): manual drafts, editing with the discount
 * rule, issue (numbering, locking), void, and who sees what.
 */

let emails: ReturnType<typeof captureEmails>;
let reception: LoggedIn;
let admin: LoggedIn;

beforeAll(async () => {
  await Promise.all([Appointment.init(), Invoice.init()]);
});

beforeEach(async () => {
  await resetDb();
  await setSettings({
    'billing.defaultTaxRateBps': 1800,
    'billing.maxDiscountPercentWithoutAdmin': 10,
  });
  emails = captureEmails();
  [reception, admin] = await Promise.all([loginAs('receptionist'), loginAs('admin')]);
});
afterEach(() => emails.restore());

const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
  api().post(`/api/v1${path}`).set(auth).send(body);
const patch = (path: string, auth: { Authorization: string }, body: object) =>
  api().patch(`/api/v1${path}`).set(auth).send(body);
const get = (path: string, auth: { Authorization: string }) =>
  api().get(`/api/v1${path}`).set(auth);

const other = (unitPricePaise: number, extra: Record<string, unknown> = {}) => ({
  kind: 'other',
  description: 'Dressing',
  unitPricePaise,
  ...extra,
});

/** A manual draft for a new patient (or `patientId`). @returns the invoice view. */
async function draft(items: object[], patientId?: string, as = reception) {
  const pid = patientId ?? (await createPatient()).id;
  const res = await post('/invoices', as.auth, { patientId: pid, items });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function issue(inv: { id: string; revision: number }, as = reception) {
  const res = await post(`/invoices/${inv.id}/issue`, as.auth, { expectedVersion: inv.revision });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
}

describe('POST /invoices (manual draft)', () => {
  it('computes every amount on the server and ignores client totals', async () => {
    const procedure = await createService({
      type: 'procedure',
      name: 'Nebulisation',
      pricePaise: 30_000,
      taxRateBps: 500,
    });
    const patient = await createPatient();
    const res = await post('/invoices', reception.auth, {
      patientId: patient.id,
      items: [
        {
          ...other(33_333),
          quantity: 1,
          taxPaise: 1,
          lineTotalPaise: 1,
          grossPaise: 999,
        },
        // Service lines take name, price and tax from the service; the price sent is ignored.
        { kind: 'procedure', serviceId: procedure._id.toString(), unitPricePaise: 1, quantity: 2 },
      ],
      totalPaise: 1,
      balancePaise: 0,
      status: 'paid',
      invoiceNumber: 'INV-2026-000001',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body.data;
    expect(inv).toMatchObject({
      kind: 'manual',
      status: 'draft',
      invoiceNumber: null,
      revision: 0,
      subtotalPaise: 93_333,
      taxTotalPaise: 6000 + 3000,
      totalPaise: 93_333 + 9000,
      amountPaidPaise: 0,
      balancePaise: 102_333,
    });
    expect(inv.items[0]).toMatchObject({
      kind: 'other',
      origin: 'staff',
      grossPaise: 33_333,
      taxRateBps: 1800,
      taxPaise: 6000,
      lineTotalPaise: 39_333,
    });
    expect(inv.items[1]).toMatchObject({
      kind: 'procedure',
      description: 'Nebulisation',
      refId: procedure._id.toString(),
      quantity: 2,
      unitPricePaise: 30_000,
      taxRateBps: 500,
      taxPaise: 3000,
    });
    const [entry] = await auditEntries('invoice.create');
    expect(entry).toMatchObject({
      actor: { role: 'receptionist' },
      changes: { after: { totalPaise: 102_333, lineCount: 2 } },
      metadata: { via: 'manual' },
    });
  });

  it('validates lines (field paths) and the appointment', async () => {
    const patient = await createPatient();
    const res = await post('/invoices', reception.auth, {
      patientId: patient.id,
      items: [other(1000), other(1000, { discountPaise: 1001 })],
    });
    expect(res.status).toBe(400);
    expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual([
      expect.objectContaining({ field: 'body.items.1.discountPaise' }),
    ]);

    const bad = await post('/invoices', reception.auth, {
      patientId: patient.id,
      items: [{ ...other(1000), quantity: 1000 }, { kind: 'other' }, { kind: 'procedure' }],
    });
    expect(bad.status).toBe(400);

    const missing = await post('/invoices', reception.auth, {
      patientId: patient.id,
      items: [{ kind: 'other', unitPricePaise: 100 }],
    });
    expect(expectErrorShape(missing.body, 'VALIDATION_ERROR').error.details).toEqual([
      expect.objectContaining({ field: 'body.items.0.description' }),
    ]);

    const someoneElse = await createPatient();
    const doctor = await loginAsDoctor();
    const appt = await insertAppointment({
      patient: someoneElse.id,
      doctor: doctor.id,
      startAt: new Date(Date.now() + 86_400_000),
    });
    const wrong = await post('/invoices', reception.auth, {
      patientId: patient.id,
      appointmentId: appt._id.toString(),
      items: [],
    });
    expect(
      (expectErrorShape(wrong.body, 'VALIDATION_ERROR').error.details as { field: string }[])[0],
    ).toMatchObject({
      field: 'body.appointmentId',
    });
  });

  it('one draft per appointment', async () => {
    const patient = await createPatient();
    const doctor = await loginAsDoctor();
    const appt = await insertAppointment({
      patient: patient.id,
      doctor: doctor.id,
      startAt: new Date(Date.now() + 86_400_000),
    });
    const body = { patientId: patient.id, appointmentId: appt._id.toString(), items: [] };
    expect((await post('/invoices', reception.auth, body)).status).toBe(201);
    const second = await post('/invoices', reception.auth, body);
    expect(second.status).toBe(409);
    expectErrorShape(second.body, 'CONFLICT');
  });

  it('an unknown patient is 404', async () => {
    const res = await post('/invoices', reception.auth, {
      patientId: '0'.repeat(24),
      items: [],
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /invoices/:id', () => {
  it('replaces the lines with the full list sent and recomputes the totals', async () => {
    const inv = await draft([other(10_000), other(20_000, { description: 'Injection' })]);
    const res = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: inv.revision,
      items: [
        { id: inv.items[1].id, quantity: 2, taxPaise: 0, lineTotalPaise: 0 },
        other(5000, { taxRateBps: 0 }),
      ],
      notes: 'Paid by employer',
      dueDate: '2030-01-15',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      revision: 1,
      notes: 'Paid by employer',
      dueDate: '2030-01-15',
      subtotalPaise: 45_000,
      taxTotalPaise: 7200,
      totalPaise: 52_200,
      balancePaise: 52_200,
    });
    expect(res.body.data.items.map((l: { description: string }) => l.description)).toEqual([
      'Injection',
      'Dressing',
    ]);
    const [entry] = await auditEntries('invoice.update');
    expect(entry!.changes).toMatchObject({
      fields: ['items', 'notes', 'dueDate'],
      before: { totalPaise: 35_400, lineCount: 2 },
      after: { totalPaise: 52_200, lineCount: 2 },
    });
  });

  it('a stale revision → 409 CONFLICT with the current revision', async () => {
    const inv = await draft([other(10_000)]);
    await patch(`/invoices/${inv.id}`, reception.auth, { expectedVersion: 0, notes: 'first' });
    const res = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 0,
      notes: 'second',
    });
    expect(res.status).toBe(409);
    expect(expectErrorShape(res.body, 'CONFLICT').error.details).toEqual({ currentRevision: 1 });
  });

  it('rejects an unknown line id and a line listed twice', async () => {
    const inv = await draft([other(10_000)]);
    const unknown = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 0,
      items: [{ id: '0'.repeat(24) }],
    });
    expect(unknown.status).toBe(400);
    const twice = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 0,
      items: [{ id: inv.items[0].id }, { id: inv.items[0].id }],
    });
    expect(twice.status).toBe(400);
  });

  describe('visit lines (from the appointment or a lab order)', () => {
    async function visitInvoice() {
      const patient = await createPatient();
      const doctor = await loginAsDoctor();
      const appt = await insertAppointment({
        patient: patient.id,
        doctor: doctor.id,
        startAt: new Date(Date.now() - 86_400_000),
        status: 'completed',
      });
      const synced = await withTransaction((session) =>
        createOrUpdateDraftForAppointment(appt._id, { session, by: doctor.id }),
      );
      const res = await get(`/invoices/${synced!.invoice._id}`, reception.auth);
      return res.body.data;
    }

    it('keep their price and quantity and cannot be removed; the discount can change', async () => {
      const inv = await visitInvoice();
      const line = inv.items[0];
      expect(line).toMatchObject({ kind: 'consultation', origin: 'visit', unitPricePaise: 50_000 });

      const repriced = await patch(`/invoices/${inv.id}`, reception.auth, {
        expectedVersion: 0,
        items: [{ id: line.id, unitPricePaise: 1 }],
      });
      expect(repriced.status).toBe(422);
      expect(
        (
          expectErrorShape(repriced.body, 'BUSINESS_RULE_VIOLATION').error.details as {
            field: string;
          }[]
        )[0],
      ).toMatchObject({
        field: 'body.items.0.unitPricePaise',
      });

      const removed = await patch(`/invoices/${inv.id}`, reception.auth, {
        expectedVersion: 0,
        items: [other(100)],
      });
      expect(removed.status).toBe(422);

      // The same values sent back are fine; a discount within the limit too.
      const ok = await patch(`/invoices/${inv.id}`, reception.auth, {
        expectedVersion: 0,
        items: [{ ...line, discountPaise: 5000 }],
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.items[0]).toMatchObject({ discountPaise: 5000, taxPaise: 8100 });
    });
  });
});

describe('discount limit (§4.9)', () => {
  /** ₹1000 + ₹1000 of 'other' lines, no tax. */
  const lines = (discount: number) => [
    other(100_000, { taxRateBps: 0, discountPaise: discount }),
    other(100_000, { taxRateBps: 0 }),
  ];

  it('a receptionist may give up to the limit; above it needs an admin', async () => {
    const atLimit = await draft(lines(20_000)); // exactly 10 %
    expect(atLimit.discountPercent).toBe(10);

    const patientId = (await createPatient()).id;
    const over = await post('/invoices', reception.auth, { patientId, items: lines(20_001) });
    expect(over.status).toBe(422);
    expect(expectErrorShape(over.body, 'DISCOUNT_REQUIRES_ADMIN').error.details).toMatchObject({
      maxPercent: 10,
    });

    const inv = await draft(lines(0));
    const raise = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 0,
      items: [{ id: inv.items[0].id, discountPaise: 50_000 }, { id: inv.items[1].id }],
    });
    expect(raise.status).toBe(422);
    expectErrorShape(raise.body, 'DISCOUNT_REQUIRES_ADMIN');
  });

  it("an admin's approval survives later edits that do not raise the discount", async () => {
    const inv = await draft(lines(0));
    const ids = inv.items.map((l: { id: string }) => l.id);
    const approved = await patch(`/invoices/${inv.id}`, admin.auth, {
      expectedVersion: 0,
      items: [{ id: ids[0], discountPaise: 50_000 }, { id: ids[1] }],
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data).toMatchObject({ discountPercent: 25 });
    expect(approved.body.data.discountApproval).toMatchObject({ byName: expect.any(String) });

    // Notes only, and the unchanged lines sent back: fine.
    const notes = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 1,
      notes: 'Staff discount',
      items: approved.body.data.items,
    });
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    // Lowering it: fine (still above the limit, approval kept).
    const lower = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 2,
      items: [{ id: ids[0], discountPaise: 40_000 }, { id: ids[1] }],
    });
    expect(lower.status).toBe(200);
    // Raising it again, or adding a discounted line: refused.
    const raise = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 3,
      items: [{ id: ids[0], discountPaise: 45_000 }, { id: ids[1] }],
    });
    expect(raise.status).toBe(422);
    const added = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 3,
      items: [{ id: ids[0] }, { id: ids[1] }, other(1000, { discountPaise: 500 })],
    });
    expect(added.status).toBe(422);
    // Back under the limit: the approval is cleared.
    const under = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 3,
      items: [{ id: ids[0], discountPaise: 0 }, { id: ids[1] }],
    });
    expect(under.status).toBe(200);
    expect(under.body.data.discountApproval).toBeNull();
  });

  it('removing full-price lines cannot push an unapproved discount over the limit', async () => {
    const inv = await draft([...lines(20_000), other(100_000, { taxRateBps: 0 })]); // 6.7 %
    const res = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: 0,
      items: [{ id: inv.items[0].id }], // 20 %
    });
    expect(res.status).toBe(422);
  });

  it('admins may create a manual draft above the limit', async () => {
    const inv = await draft(lines(100_000), undefined, admin);
    expect(inv.discountPercent).toBe(50);
    expect(inv.discountApproval).not.toBeNull();
  });
});

describe('POST /invoices/:id/issue', () => {
  it('assigns the next number, locks the invoice and tells the patient (no amounts)', async () => {
    const patient = await createPatient({ email: 'asha@example.com' });
    const inv = await draft([other(33_333)], patient.id);
    const issued = await issue(inv);
    const year = clinicToday('Asia/Kolkata').slice(0, 4);
    expect(issued).toMatchObject({
      invoiceNumber: `INV-${year}-000001`,
      status: 'issued',
      issuedAt: expect.any(String),
      issuedBy: { name: expect.any(String) },
      dueDate: clinicToday('Asia/Kolkata'),
      balancePaise: 39_333,
    });

    const locked = await patch(`/invoices/${inv.id}`, reception.auth, {
      expectedVersion: issued.revision,
      notes: 'too late',
    });
    expect(locked.status).toBe(409);
    expectErrorShape(locked.body, 'RECORD_LOCKED');
    const again = await post(`/invoices/${inv.id}/issue`, reception.auth, {
      expectedVersion: issued.revision,
    });
    expect(again.status).toBe(409);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');

    await vi.waitFor(() => expect(emails.sent).toHaveLength(1));
    const mail = emails.sent[0]!;
    expect(mail.to).toBe('asha@example.com');
    const content = JSON.stringify(mail);
    expect(content).toContain(issued.invoiceNumber);
    expect(content).not.toMatch(/₹|Rs\.?|393|333|Dressing/);
    const [entry] = await auditEntries('invoice.issue');
    expect(entry).toMatchObject({ resource: { number: issued.invoiceNumber } });
  });

  it('an invoice without lines → 422 INVOICE_EMPTY; a stale revision → 409', async () => {
    const empty = await draft([]);
    const res = await post(`/invoices/${empty.id}/issue`, reception.auth, { expectedVersion: 0 });
    expect(res.status).toBe(422);
    expectErrorShape(res.body, 'INVOICE_EMPTY');

    const inv = await draft([other(100)]);
    const stale = await post(`/invoices/${inv.id}/issue`, reception.auth, { expectedVersion: 7 });
    expect(stale.status).toBe(409);
    expectErrorShape(stale.body, 'CONFLICT');
  });

  it('uses the clinic prefix; a free invoice is paid at once', async () => {
    await setSettings({ 'billing.invoicePrefix': 'MA' });
    const free = await draft([other(0)]);
    const issued = await issue(free);
    expect(issued.invoiceNumber).toMatch(/^MA-\d{4}-000001$/);
    expect(issued.status).toBe('paid');
    expect(issued.statusHistory.map((h: { status: string }) => h.status)).toEqual([
      'draft',
      'issued',
      'paid',
    ]);
  });

  it('20 parallel issues get unique, consecutive numbers', async () => {
    const drafts = [];
    for (let i = 0; i < 20; i += 1) drafts.push(await draft([other(1000 + i)]));
    const results = await Promise.all(
      drafts.map((d) =>
        post(`/invoices/${d.id}/issue`, reception.auth, { expectedVersion: d.revision }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    const seqs = results
      .map((r) => Number(r.body.data.invoiceNumber.split('-')[2]))
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('the same draft issued twice in parallel: one wins', async () => {
    const inv = await draft([other(1000)]);
    const results = await Promise.all(
      [1, 2].map(() => post(`/invoices/${inv.id}/issue`, reception.auth, { expectedVersion: 0 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await Invoice.countDocuments({ invoiceNumber: { $exists: true } })).toBe(1);
  });
});

describe('POST /invoices/:id/void', () => {
  it('voids drafts and unpaid issued invoices; the reason is kept', async () => {
    const d = await draft([other(1000)]);
    const voided = await post(`/invoices/${d.id}/void`, reception.auth, { reason: 'Duplicate' });
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({
      status: 'void',
      void: { reason: 'Duplicate', byName: expect.any(String) },
    });

    const issued = await issue(await draft([other(1000)]));
    const byAdmin = await post(`/invoices/${issued.id}/void`, admin.auth, {
      reason: 'Wrong patient',
    });
    expect(byAdmin.status).toBe(200);
    const again = await post(`/invoices/${issued.id}/void`, admin.auth, { reason: 'Again' });
    expect(again.status).toBe(409);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');
    const [entry] = await auditEntries('invoice.void');
    expect(entry).toMatchObject({ metadata: { fromStatus: 'draft', reasonGiven: true } });
    expect(JSON.stringify(entry)).not.toContain('Duplicate');
  });

  it('money paid on it → 422 VOID_REQUIRES_REFUND (partly or fully paid)', async () => {
    for (const [paid, status] of [
      [400, 'partially_paid'],
      [1180, 'paid'],
    ] as const) {
      const issued = await issue(await draft([other(1000)]));
      await Invoice.updateOne(
        { _id: issued.id },
        { $set: { amountPaidPaise: paid, balancePaise: 1180 - paid, status } },
        paymentWriteOptions(),
      );
      const res = await post(`/invoices/${issued.id}/void`, reception.auth, { reason: 'Mistake' });
      expect(res.status).toBe(422);
      expectErrorShape(res.body, 'VOID_REQUIRES_REFUND');
    }
  });

  it('needs a reason', async () => {
    const d = await draft([other(1000)]);
    const res = await post(`/invoices/${d.id}/void`, reception.auth, { reason: ' ' });
    expect(res.status).toBe(400);
  });
});

describe('reading and listing', () => {
  it('lists with filters, search and totals of the filtered set', async () => {
    const asha = await createPatient({ firstName: 'Asha', lastName: 'Kulkarni' });
    const ravi = await createPatient({ firstName: 'Ravi', lastName: 'Menon' });
    const a1 = await issue(await draft([other(10_000, { taxRateBps: 0 })], asha.id));
    await draft([other(20_000, { taxRateBps: 0 })], asha.id);
    const r1 = await issue(await draft([other(30_000, { taxRateBps: 0 })], ravi.id));
    await Invoice.updateOne(
      { _id: r1.id },
      { $set: { amountPaidPaise: 10_000, balancePaise: 20_000, status: 'partially_paid' } },
      paymentWriteOptions(),
    );
    const voided = await issue(await draft([other(40_000, { taxRateBps: 0 })], ravi.id));
    await post(`/invoices/${voided.id}/void`, reception.auth, { reason: 'Wrong' });

    const all = await get('/invoices', reception.auth);
    expect(all.status).toBe(200);
    expect(all.body.meta).toMatchObject({
      total: 4,
      totals: { billedPaise: 40_000, collectedPaise: 10_000, outstandingPaise: 30_000 },
    });
    expect(all.body.data[0]).not.toHaveProperty('items');

    const open = await get('/invoices?status=issued,partially_paid', reception.auth);
    expect(open.body.data.map((i: { id: string }) => i.id).sort()).toEqual([a1.id, r1.id].sort());

    const byName = await get('/invoices?q=asha', reception.auth);
    expect(byName.body.meta.total).toBe(2);
    const seq = Number(r1.invoiceNumber.split('-')[2]);
    const byNumber = await get(
      `/invoices?q=${r1.invoiceNumber.split('-').slice(0, 2).join('-').toLowerCase()}-${seq}`,
      admin.auth,
    );
    expect(byNumber.body.data.map((i: { id: string }) => i.id)).toEqual([r1.id]);
    const byPatient = await get(`/invoices?patient=${ravi.id}&status=void`, admin.auth);
    expect(byPatient.body.meta).toMatchObject({ total: 1, totals: { billedPaise: 0 } });

    const today = clinicToday('Asia/Kolkata');
    const dated = await get(`/invoices?from=${today}&to=${today}`, reception.auth);
    expect(dated.body.meta.total).toBe(4);
    const past = await get('/invoices?from=2020-01-01&to=2020-01-31', reception.auth);
    expect(past.body.meta.total).toBe(0);
  });

  it('GET /invoices/:id is audited as a debounced view', async () => {
    const inv = await draft([other(1000)]);
    await get(`/invoices/${inv.id}`, reception.auth);
    await get(`/invoices/${inv.id}`, reception.auth);
    expect(await auditEntries('invoice.view')).toHaveLength(1);
  });

  describe('patients', () => {
    it('see their own issued invoices only; drafts and others are 404', async () => {
      const me = await loginAsPatient();
      const mine = await issue(await draft([other(1000)], me.patientId));
      const myDraft = await draft([other(2000)], me.patientId);
      const theirs = await issue(await draft([other(3000)]));

      const list = await get('/invoices?patient=' + theirs.patient.id, me.auth);
      expect(list.status).toBe(200);
      expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([mine.id]);

      const own = await get(`/invoices/${mine.id}`, me.auth);
      expect(own.status).toBe(200);
      expect(own.body.data).not.toHaveProperty('notes');
      expect(own.body.data).not.toHaveProperty('statusHistory');
      expect(own.body.data).not.toHaveProperty('cancelledItemsBilled');
      expect(own.body.data.patient).not.toHaveProperty('phone');

      for (const id of [myDraft.id, theirs.id]) {
        const res = await get(`/invoices/${id}`, me.auth);
        expect(res.status).toBe(404);
        expectErrorShape(res.body, 'NOT_FOUND');
      }
      const denied = await auditEntries('access.denied');
      expect(denied.map((e) => e.metadata)).toEqual([
        { reason: 'invoice_access' },
        { reason: 'invoice_access' },
      ]);
    });

    it('while the account link is pending → 403 PATIENT_LINK_PENDING', async () => {
      const { id } = await createPatient();
      const pending = await createUser('patient', {
        patient: id,
        patientLinkStatus: 'pending_verification',
      });
      const login = await api()
        .post('/api/v1/auth/login')
        .send({ email: pending.email, password: 'Clinic2026!pass' });
      const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
      const res = await get('/invoices', auth);
      expect(res.status).toBe(403);
      expectErrorShape(res.body, 'PATIENT_LINK_PENDING');
    });

    it('cannot create, edit, issue or void', async () => {
      const me = await loginAsPatient();
      const inv = await draft([other(1000)], me.patientId);
      expect((await post('/invoices', me.auth, { patientId: me.patientId })).status).toBe(403);
      expect((await patch(`/invoices/${inv.id}`, me.auth, { expectedVersion: 0 })).status).toBe(
        403,
      );
      expect(
        (await post(`/invoices/${inv.id}/issue`, me.auth, { expectedVersion: 0 })).status,
      ).toBe(403);
      expect((await post(`/invoices/${inv.id}/void`, me.auth, { reason: 'x' })).status).toBe(403);
    });
  });

  it('doctors and lab technicians have no invoice access', async () => {
    const inv = await draft([other(1000)]);
    for (const role of ['doctor', 'labtech'] as const) {
      const who = await loginAs(role);
      expect((await get('/invoices', who.auth)).status).toBe(403);
      expect((await get(`/invoices/${inv.id}`, who.auth)).status).toBe(403);
    }
  });
});

describe('desk extras (Phase 7 client)', () => {
  it('a lab test line from the catalogue: name and price snapshotted, the default tax', async () => {
    const test = await LabTest.create({
      code: 'DESK1',
      name: 'Blood sugar (random)',
      category: 'biochemistry',
      sampleType: 'blood',
      pricePaise: 15_000,
    });
    const inv = await draft([
      { kind: 'lab_test', labTestId: test._id.toString(), unitPricePaise: 1, quantity: 2 },
    ]);
    expect(inv.items[0]).toMatchObject({
      kind: 'lab_test',
      origin: 'staff',
      description: 'Blood sugar (random)',
      refId: test._id.toString(),
      labOrderItemId: null,
      unitPricePaise: 15_000,
      quantity: 2,
      taxRateBps: 1800,
    });
    const patientId = (await createPatient()).id;
    const missing = await post('/invoices', reception.auth, {
      patientId,
      items: [{ kind: 'lab_test' }],
    });
    expect(expectErrorShape(missing.body, 'VALIDATION_ERROR').error.details).toEqual([
      expect.objectContaining({ field: 'body.items.0.labTestId' }),
    ]);
  });

  it('staff views carry the billing rules; the patient view does not', async () => {
    await setSettings({ 'billing.paymentMethods': ['cash', 'upi'], 'billing.taxLabel': 'GST' });
    const me = await loginAsPatient();
    const inv = await issue(await draft([other(1000)], me.patientId));
    expect(inv.rules).toEqual({
      taxLabel: 'GST',
      defaultTaxRateBps: 1800,
      maxDiscountPercentWithoutAdmin: 10,
      paymentMethods: ['cash', 'upi'],
    });
    const own = await get(`/invoices/${inv.id}`, me.auth);
    expect(own.body.data).not.toHaveProperty('rules');
  });

  it('?needsAttention lists invoices with billed cancelled tests; rows name the doctor', async () => {
    const plain = await issue(await draft([other(1000)]));
    const flagged = await issue(await draft([other(2000)]));
    await Invoice.updateOne(
      { _id: flagged.id },
      {
        $push: {
          cancelledItemsBilled: {
            description: 'CBC',
            lineTotalPaise: 2000,
            labOrderId: new Types.ObjectId(),
            itemId: new Types.ObjectId(),
            at: new Date(),
          },
        },
      },
    );
    const res = await get('/invoices?needsAttention=true', reception.auth);
    expect(res.body.data.map((i: { id: string }) => i.id)).toEqual([flagged.id]);
    expect(res.body.data[0].hasCancelledItemsBilled).toBe(true);
    expect((await get('/invoices', reception.auth)).body.meta.total).toBe(2);
    expect(plain.id).toBeDefined();
  });
});
