import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { createOrUpdateDraftForAppointment } from '../src/modules/invoices/sync.service.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { withTransaction } from '../src/utils/transaction.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createLabTest,
  createPatient,
  createService,
  insertAppointment,
  loginAsDoctor,
  readyToSign,
  setSettings,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Automatic invoices (Phase 7): the draft created in the sign transaction, tests ordered after
 * signing, cancelled tests and cancelled appointments. All idempotent and atomic with what
 * caused them.
 */

let emails: ReturnType<typeof captureEmails>;
let reception: LoggedIn;

beforeAll(async () => {
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    LabOrder.init(),
    Invoice.init(),
  ]);
});

beforeEach(async () => {
  await resetDb();
  await useMiddayClinicZone();
  await setSettings({ 'billing.defaultTaxRateBps': 1800 });
  emails = captureEmails();
  reception = await loginAs('receptionist');
});
afterEach(() => {
  vi.restoreAllMocks();
  emails.restore();
});

const post = (path: string, auth: { Authorization: string }, body: object = {}) =>
  api().post(`/api/v1${path}`).set(auth).send(body);

/** A note ready to sign with draft lab orders for `tests` (one order). */
async function noteWithLabDraft(
  testIds: string[],
  options: Parameters<typeof readyToSign>[0] = {},
) {
  const ready = await readyToSign({ items: [], ...options });
  if (testIds.length > 0) {
    const res = await post('/lab-orders', ready.doctor.auth, {
      encounterId: ready.encounterId,
      testIds,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  return ready;
}

const invoicesOf = (appointmentId: string) =>
  Invoice.find({ appointment: appointmentId }).sort({ createdAt: 1 }).lean();

describe('draft invoice on signing', () => {
  it('creates the visit draft with the consultation and every placed lab test', async () => {
    const [cbc, lft] = await Promise.all([
      createLabTest({ pricePaise: 25_000 }),
      createLabTest({ pricePaise: 40_000 }),
    ]);
    const ready = await noteWithLabDraft([cbc._id.toString(), lft._id.toString()]);
    const signed = await signNote(ready.doctor, ready.encounterId);

    const [inv, ...rest] = await invoicesOf(ready.appointmentId);
    expect(rest).toHaveLength(0);
    expect(signed.invoice).toEqual({ id: inv!._id.toString() });
    expect(inv).toMatchObject({ kind: 'appointment', status: 'draft' });
    expect(inv!.invoiceNumber).toBeUndefined();
    expect(inv!.items.map((l) => [l.kind, l.origin, l.unitPricePaise, l.taxPaise])).toEqual([
      ['consultation', 'visit', 50_000, 9000], // the appointment's snapshot, default 18%
      ['lab_test', 'visit', 25_000, 4500],
      ['lab_test', 'visit', 40_000, 7200],
    ]);
    const order = await LabOrder.findOne({ encounter: ready.encounterId }).lean();
    expect(inv!.items[1]).toMatchObject({
      labOrder: order!._id,
      labOrderItem: order!.items[0]!._id,
      refId: cbc._id,
      description: cbc.name,
      quantity: 1,
    });
    expect(inv).toMatchObject({
      subtotalPaise: 115_000,
      discountTotalPaise: 0,
      taxTotalPaise: 20_700,
      totalPaise: 135_700,
      amountPaidPaise: 0,
      balancePaise: 135_700,
    });
    const [created] = await auditEntries('invoice.create');
    expect(created).toMatchObject({
      actor: { role: 'doctor' },
      metadata: { via: 'sign', linesAdded: 3, totalPaise: 135_700 },
    });
  });

  it("uses the service's own tax rate for the consultation when it has one", async () => {
    const service = await createService({ taxRateBps: 500 });
    const doctor = await loginAsDoctor();
    const { appointmentId, encounterId } = await readyToSign({ doctor, items: [] });
    await Appointment.updateOne({ _id: appointmentId }, { $set: { service: service._id } });
    await signNote(doctor, encounterId);
    const [inv] = await invoicesOf(appointmentId);
    expect(inv!.items[0]).toMatchObject({ refId: service._id, taxRateBps: 500, taxPaise: 2500 });
  });

  it('is atomic with signing: a failing invoice write leaves the note unsigned and no invoice', async () => {
    const test = await createLabTest();
    const ready = await noteWithLabDraft([test._id.toString()]);
    const original = Invoice.create.bind(Invoice);
    vi.spyOn(Invoice, 'create').mockImplementationOnce((async (...args: unknown[]) => {
      await (original as (...a: unknown[]) => Promise<unknown>)(...args); // written, then…
      throw new Error('disk full');
    }) as never);

    const current = await api()
      .get(`/api/v1/encounters/${ready.encounterId}`)
      .set(ready.doctor.auth);
    const res = await post(`/encounters/${ready.encounterId}/sign`, ready.doctor.auth, {
      expectedVersion: current.body.data.revision,
    });
    expect(res.status).toBe(500);
    expect(await Invoice.countDocuments()).toBe(0);
    expect((await Encounter.findById(ready.encounterId).lean())!.status).toBe('draft');
    expect((await LabOrder.findOne({ encounter: ready.encounterId }).lean())!.status).toBe('draft');
    expect((await Appointment.findById(ready.appointmentId).lean())!.status).toBe(
      'in_consultation',
    );

    // Signing again (no failure) creates it.
    await signNote(ready.doctor, ready.encounterId);
    expect(await Invoice.countDocuments({ appointment: ready.appointmentId })).toBe(1);
  });

  it('is idempotent: syncing again adds nothing', async () => {
    const test = await createLabTest();
    const ready = await noteWithLabDraft([test._id.toString()]);
    await signNote(ready.doctor, ready.encounterId);
    const before = (await invoicesOf(ready.appointmentId))[0]!;
    const again = await withTransaction((session) =>
      createOrUpdateDraftForAppointment(ready.appointmentId, { session, by: ready.doctor.id }),
    );
    expect(again).toBeNull();
    const after = await invoicesOf(ready.appointmentId);
    expect(after).toHaveLength(1);
    expect(after[0]!.items).toHaveLength(2);
    expect(after[0]!.__v).toBe(before.__v);
  });

  it('adds to a draft reception already started for the visit, without a second consultation', async () => {
    const ready = await noteWithLabDraft([]);
    const manual = await post('/invoices', reception.auth, {
      patientId: ready.patientId,
      appointmentId: ready.appointmentId,
      items: [{ kind: 'other', description: 'Dressing', unitPricePaise: 10_000 }],
    });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    await signNote(ready.doctor, ready.encounterId);
    const invoices = await invoicesOf(ready.appointmentId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.items.map((l) => l.kind)).toEqual(['other', 'consultation']);
  });
});

describe('lab tests ordered after signing', () => {
  async function signedVisit() {
    const ready = await noteWithLabDraft([]);
    await signNote(ready.doctor, ready.encounterId);
    return ready;
  }
  const order = async (ready: Awaited<ReturnType<typeof signedVisit>>, testIds: string[]) => {
    const res = await post('/lab-orders', ready.doctor.auth, {
      encounterId: ready.encounterId,
      testIds,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('ordered');
    return res.body.data;
  };

  it("go on the visit's draft invoice", async () => {
    const ready = await signedVisit();
    const test = await createLabTest({ pricePaise: 30_000 });
    await order(ready, [test._id.toString()]);
    const invoices = await invoicesOf(ready.appointmentId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.items.map((l) => l.kind)).toEqual(['consultation', 'lab_test']);
    expect(invoices[0]!.totalPaise).toBe(59_000 + 35_400);
    const [sync] = await auditEntries('invoice.sync');
    expect(sync).toMatchObject({ metadata: { via: 'lab_order', linesAdded: 1 } });
  });

  it('get a supplementary draft once the invoice is issued', async () => {
    const ready = await signedVisit();
    const [first] = await invoicesOf(ready.appointmentId);
    const issued = await post(`/invoices/${first!._id}/issue`, reception.auth, {
      expectedVersion: first!.__v,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);

    const test = await createLabTest({ pricePaise: 30_000 });
    await order(ready, [test._id.toString()]);
    const [original, supplementary] = await invoicesOf(ready.appointmentId);
    expect(original).toMatchObject({ status: 'issued', totalPaise: 59_000 });
    expect(original!.items).toHaveLength(1);
    expect(supplementary).toMatchObject({ kind: 'supplementary', status: 'draft' });
    expect(supplementary!.items.map((l) => [l.kind, l.unitPricePaise])).toEqual([
      ['lab_test', 30_000],
    ]);

    // A second order lands on the same supplementary draft.
    await order(ready, [(await createLabTest())._id.toString()]);
    const all = await invoicesOf(ready.appointmentId);
    expect(all).toHaveLength(2);
    expect(all[1]!.items).toHaveLength(2);
  });
});

describe('cancelled lab tests', () => {
  async function signedWithOrder(prices: number[]) {
    const tests = await Promise.all(prices.map((pricePaise) => createLabTest({ pricePaise })));
    const ready = await noteWithLabDraft(tests.map((t) => t._id.toString()));
    await signNote(ready.doctor, ready.encounterId);
    const o = (await LabOrder.findOne({ encounter: ready.encounterId }).lean())!;
    return { ...ready, order: o };
  }

  it('are removed from a draft invoice and the totals recomputed', async () => {
    const v = await signedWithOrder([25_000, 40_000]);
    const res = await post(
      `/lab-orders/${v.order._id}/items/${v.order.items[0]!._id}/cancel`,
      v.doctor.auth,
      { reason: 'Not needed' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [inv] = await invoicesOf(v.appointmentId);
    expect(inv!.items.map((l) => l.unitPricePaise)).toEqual([50_000, 40_000]);
    expect(inv!.totalPaise).toBe(59_000 + 47_200);
    expect(inv!.cancelledItemsBilled).toHaveLength(0);
    const [sync] = await auditEntries('invoice.sync');
    expect(sync).toMatchObject({ metadata: { via: 'lab_cancel', linesRemoved: 1 } });
  });

  it('cancelling the whole order removes all its lines', async () => {
    const v = await signedWithOrder([25_000, 40_000]);
    const res = await post(`/lab-orders/${v.order._id}/cancel`, v.doctor.auth, {
      reason: 'Patient declined',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [inv] = await invoicesOf(v.appointmentId);
    expect(inv!.items.map((l) => l.kind)).toEqual(['consultation']);
    expect(inv!.totalPaise).toBe(59_000);
  });

  it('are flagged on an issued invoice, which is otherwise left untouched', async () => {
    const v = await signedWithOrder([25_000, 40_000]);
    const [draft] = await invoicesOf(v.appointmentId);
    await post(`/invoices/${draft!._id}/issue`, reception.auth, { expectedVersion: draft!.__v });

    const item = v.order.items[1]!;
    const res = await post(`/lab-orders/${v.order._id}/items/${item._id}/cancel`, v.doctor.auth, {
      reason: 'Reagent unavailable',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [inv] = await invoicesOf(v.appointmentId);
    expect(inv).toMatchObject({ status: 'issued', totalPaise: draft!.totalPaise });
    expect(inv!.items).toHaveLength(3);
    expect(inv!.cancelledItemsBilled).toEqual([
      expect.objectContaining({
        description: item.testSnapshot.name,
        lineTotalPaise: 47_200,
        labOrderId: v.order._id,
        itemId: item._id,
        lineId: inv!.items[2]!._id,
      }),
    ]);

    // Cancelling the rest of the order flags only the remaining test (each item once).
    await post(`/lab-orders/${v.order._id}/cancel`, v.doctor.auth, { reason: 'Patient left' });
    const after = (await invoicesOf(v.appointmentId))[0]!;
    expect(after.cancelledItemsBilled.map((c) => c.itemId.toString())).toEqual([
      item._id.toString(),
      v.order.items[0]!._id.toString(),
    ]);
    expect(after.totalPaise).toBe(draft!.totalPaise);
  });
});

describe('cancelled appointments', () => {
  it("void the visit's draft invoice in the same transaction", async () => {
    const doctor = await loginAsDoctor();
    const patient = await createPatient();
    const appt = await insertAppointment({
      patient: patient.id,
      doctor: doctor.id,
      startAt: new Date(Date.now() + 3 * 86_400_000),
    });
    const created = await post('/invoices', reception.auth, {
      patientId: patient.id,
      appointmentId: appt._id.toString(),
      items: [{ kind: 'other', description: 'Advance for procedure', unitPricePaise: 100_000 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await post(`/appointments/${appt._id}/cancel`, reception.auth, {
      reason: 'Patient travelling',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const inv = await Invoice.findById(created.body.data.id).lean();
    expect(inv).toMatchObject({ status: 'void', void: { reason: 'Appointment cancelled' } });
    expect(inv!.statusHistory.map((h) => h.status)).toEqual(['draft', 'void']);
    const [voided] = await auditEntries('invoice.void');
    expect(voided).toMatchObject({ metadata: { via: 'appointment_cancel', fromStatus: 'draft' } });
  });

  it('a cancellation without an invoice changes nothing', async () => {
    const doctor = await loginAsDoctor();
    const patient = await createPatient();
    const appt = await insertAppointment({
      patient: patient.id,
      doctor: doctor.id,
      startAt: new Date(Date.now() + 3 * 86_400_000),
    });
    const res = await post(`/appointments/${appt._id}/cancel`, reception.auth, {
      reason: 'Patient travelling',
    });
    expect(res.status).toBe(200);
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await auditEntries('invoice.void')).toHaveLength(0);
  });
});

it('an unknown appointment is a 404 for the sync', async () => {
  await expect(
    withTransaction((session) =>
      createOrUpdateDraftForAppointment(new Types.ObjectId(), { session, by: 'x'.padEnd(24, '0') }),
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
});
