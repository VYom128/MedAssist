import type { Server } from 'socket.io';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { LabTest } from '../src/modules/labTests/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { clinicToday } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createLabTest,
  createPatient,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
  readyToSign,
  signNote,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Lab orders, step 1 (spec §7.14, §4.7, §5.4, Phase 6 decisions): ordering from a consultation
 * (draft → placed on signing), the documentation window, draft edits, discarding, cancelling
 * orders and single tests, and what each role reads.
 */

let emails: ReturnType<typeof captureEmails>;
let tz: string;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init(), LabOrder.init()]);
  tz = await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

/** Status + the standard error envelope with `code`. */
function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return expectErrorShape(res.body, code);
}

const year = () => clinicToday(tz).slice(0, 4);
const post = (who: LoggedIn, path: string, body: object = {}) =>
  api().post(`/api/v1${path}`).set(who.auth).send(body);
const get = (who: LoggedIn, path: string) => api().get(`/api/v1${path}`).set(who.auth);

type Test = Awaited<ReturnType<typeof createLabTest>>;
const order = (who: LoggedIn, encounterId: string, tests: Test[], extra: object = {}) =>
  post(who, '/lab-orders', {
    encounterId,
    testIds: tests.map((t) => t._id.toString()),
    ...extra,
  });

/** A signed note of a new consultation (inside the documentation window). */
async function signedConsultation(doctor?: LoggedIn & { id: string }) {
  const c = await readyToSign({ doctor, items: [] });
  await signNote(c.doctor, c.encounterId);
  return c;
}

describe('POST /lab-orders', () => {
  it('on a draft note: a draft order (no number) with snapshots; audited; hidden from the lab', async () => {
    const c = await startedConsultation();
    const [cbc, lft] = [
      await createLabTest({ name: 'Complete blood count' }),
      await createLabTest({ pricePaise: 60_000 }),
    ];
    const res = await order(c.doctor, c.encounterId, [cbc!, lft!], {
      priority: 'urgent',
      clinicalNotes: 'Fever for 5 days, rule out dengue',
    });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/sent when you sign/);
    expect(res.body.data).toMatchObject({
      status: 'draft',
      orderNumber: null,
      orderedAt: null,
      priority: 'urgent',
      clinicalNotes: 'Fever for 5 days, rule out dengue',
      encounterId: c.encounterId,
      appointmentId: c.appointmentId,
      patient: { id: c.patientId },
      items: [
        { code: cbc!.code, name: 'Complete blood count', status: 'pending', results: [] },
        { code: lft!.code, status: 'pending' },
      ],
    });
    const stored = await LabOrder.findById(res.body.data.id).lean();
    expect(stored!.items[1]!.testSnapshot).toMatchObject({
      pricePaise: 60_000,
      sampleType: 'blood',
    });
    const [entry] = await auditEntries('lab_order.create');
    expect(entry).toMatchObject({
      patient: expect.anything(),
      metadata: { status: 'draft', testCount: 2, priority: 'urgent', clinicalNotesGiven: true },
    });
    expect(JSON.stringify(entry)).not.toMatch(/dengue/);

    const lab = await loginAs('labtech');
    expect((await get(lab, '/lab-orders')).body.data).toEqual([]);
    expect((await get(lab, `/lab-orders/${res.body.data.id}`)).status).toBe(404);
  });

  it('on a signed note inside the window: placed at once with a LAB number', async () => {
    const c = await signedConsultation();
    const test = await createLabTest();
    const res = await order(c.doctor, c.encounterId, [test]);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'ordered',
      orderNumber: `LAB-${year()}-000001`,
      orderedAt: expect.any(String),
      priority: 'routine',
    });
    const lab = await loginAs('labtech');
    const list = await get(lab, '/lab-orders');
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([res.body.data.id]);
  });

  it('422 DOCUMENTATION_WINDOW_CLOSED more than 72 h after the visit', async () => {
    const c = await signedConsultation();
    await Appointment.updateOne(
      { _id: c.appointmentId },
      { $set: { 'queue.completedAt': new Date(Date.now() - 73 * 3_600_000) } },
    );
    const res = await order(c.doctor, c.encounterId, [await createLabTest()]);
    expectError(res, 422, 'DOCUMENTATION_WINDOW_CLOSED');
  });

  it('rejects duplicate tests (400) and inactive or unknown tests (422 with positions)', async () => {
    const c = await startedConsultation();
    const test = await createLabTest();
    const old = await createLabTest({ isActive: false });
    const dup = await order(c.doctor, c.encounterId, [test, test]);
    expectError(dup, 400, 'VALIDATION_ERROR');
    const inactive = await order(c.doctor, c.encounterId, [test, old]);
    expectError(inactive, 422, 'BUSINESS_RULE_VIOLATION');
    expect(inactive.body.error.details).toEqual([
      { field: 'body.testIds.1', message: 'Not an active lab test' },
    ]);
    const empty = await post(c.doctor, '/lab-orders', { encounterId: c.encounterId, testIds: [] });
    expectError(empty, 400, 'VALIDATION_ERROR');
  });

  it("404 on another doctor's note (audited access.denied)", async () => {
    const c = await startedConsultation();
    const other = await loginAsDoctor();
    const res = await order(other, c.encounterId, [await createLabTest()]);
    expectError(res, 404, 'NOT_FOUND');
    expect(await auditEntries('access.denied')).toHaveLength(1);
    expect(await LabOrder.countDocuments()).toBe(0);
  });
});

describe('draft orders', () => {
  it('PATCH changes tests, priority and notes (empty notes clear); audited field names', async () => {
    const c = await startedConsultation();
    const [a, b] = [await createLabTest(), await createLabTest()];
    const draft = await order(c.doctor, c.encounterId, [a!], { clinicalNotes: 'Anaemia?' });
    const res = await api()
      .patch(`/api/v1/lab-orders/${draft.body.data.id}`)
      .set(c.doctor.auth)
      .send({
        testIds: [b!._id.toString(), a!._id.toString()],
        priority: 'urgent',
        clinicalNotes: '',
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ priority: 'urgent', clinicalNotes: null });
    expect(res.body.data.items.map((i: { code: string }) => i.code)).toEqual([b!.code, a!.code]);
    const [entry] = await auditEntries('lab_order.update');
    expect(entry!.changes).toMatchObject({ fields: ['testIds', 'priority', 'clinicalNotes'] });
  });

  it('a placed order cannot be edited (409 RECORD_LOCKED); only its doctor edits a draft (404)', async () => {
    const c = await signedConsultation();
    const placed = await order(c.doctor, c.encounterId, [await createLabTest()]);
    const locked = await api()
      .patch(`/api/v1/lab-orders/${placed.body.data.id}`)
      .set(c.doctor.auth)
      .send({ priority: 'urgent' });
    expectError(locked, 409, 'RECORD_LOCKED');

    const d = await startedConsultation();
    const draft = await order(d.doctor, d.encounterId, [await createLabTest()]);
    const stranger = await api()
      .patch(`/api/v1/lab-orders/${draft.body.data.id}`)
      .set(c.doctor.auth)
      .send({ priority: 'urgent' });
    expectError(stranger, 404, 'NOT_FOUND');
  });

  it('discard: draft → cancelled, gone from lists, never placed; placed orders cannot be discarded', async () => {
    const c = await startedConsultation();
    const draft = await order(c.doctor, c.encounterId, [await createLabTest()]);
    const res = await post(c.doctor, `/lab-orders/${draft.body.data.id}/discard`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', orderNumber: null });
    expect((await get(c.doctor, '/lab-orders')).body.data).toEqual([]);
    expect(await auditEntries('lab_order.discard')).toHaveLength(1);
    const again = await post(c.doctor, `/lab-orders/${draft.body.data.id}/discard`);
    expectError(again, 409, 'INVALID_STATUS_TRANSITION');

    const s = await signedConsultation();
    const placed = await order(s.doctor, s.encounterId, [await createLabTest()]);
    const refused = await post(s.doctor, `/lab-orders/${placed.body.data.id}/discard`);
    expectError(refused, 409, 'INVALID_STATUS_TRANSITION');
  });
});

describe('signing places the draft orders (spec §4.7 step 5)', () => {
  it('drafts become ordered with consecutive numbers in the sign transaction; discarded stay cancelled', async () => {
    const c = await readyToSign({ items: [] });
    const [a, b] = [await createLabTest(), await createLabTest()];
    const first = await order(c.doctor, c.encounterId, [a!]);
    const second = await order(c.doctor, c.encounterId, [b!], { priority: 'urgent' });
    const dropped = await order(c.doctor, c.encounterId, [a!]);
    await post(c.doctor, `/lab-orders/${dropped.body.data.id}/discard`);

    const events: unknown[] = [];
    setSocketServer({
      to: (rooms: string[]) => ({ emit: (e: string, p: unknown) => events.push([rooms, e, p]) }),
    } as unknown as Server);
    let signed;
    try {
      signed = await signNote(c.doctor, c.encounterId);
    } finally {
      setSocketServer(null);
    }
    expect(signed.labOrders).toEqual([
      { id: first.body.data.id, orderNumber: `LAB-${year()}-000001` },
      { id: second.body.data.id, orderNumber: `LAB-${year()}-000002` },
    ]);
    const orders = await LabOrder.find().sort({ createdAt: 1 }).lean();
    expect(orders.map((o) => o.status)).toEqual(['ordered', 'ordered', 'cancelled']);
    expect(orders[0]!.orderedAt).toBeInstanceOf(Date);
    expect(orders[0]!.statusHistory.map((h) => h.status)).toEqual(['draft', 'ordered']);
    expect(await auditEntries('lab_order.submit')).toHaveLength(2);
    expect(events).toContainEqual([
      'lab',
      'lab.worklist.updated',
      { orderIds: [first.body.data.id, second.body.data.id] },
    ]);
  });

  it('a failure while placing them rolls the whole signing back', async () => {
    const c = await readyToSign();
    const test = await createLabTest();
    const draft = await order(c.doctor, c.encounterId, [test]);
    // Another order already holds the number the counter will hand out → duplicate key.
    const blocker = await insertLabOrder({
      patient: c.patientId,
      doctor: c.doctor.id,
      tests: [test],
      orderNumber: `LAB-${year()}-000001`,
    });
    const current = await get(c.doctor, `/encounters/${c.encounterId}`);
    const res = await post(c.doctor, `/encounters/${c.encounterId}/sign`, {
      expectedVersion: current.body.data.revision,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await Encounter.findById(c.encounterId).lean())!.status).toBe('draft');
    expect((await Prescription.findById(c.prescriptionId).lean())!.status).toBe('draft');
    expect((await Appointment.findById(c.appointmentId).lean())!.status).toBe('in_consultation');
    expect((await LabOrder.findById(draft.body.data.id).lean())!.status).toBe('draft');

    // Without the clash the same signing succeeds – and the counter was rolled back too.
    await LabOrder.collection.deleteOne({ _id: blocker._id });
    const ok = await signNote(c.doctor, c.encounterId);
    expect(ok.labOrders).toEqual([{ id: draft.body.data.id, orderNumber: `LAB-${year()}-000001` }]);
  });
});

describe('cancelling', () => {
  async function placedOrder(tests = 2) {
    const c = await signedConsultation();
    const list = await Promise.all(Array.from({ length: tests }, () => createLabTest()));
    const res = await order(c.doctor, c.encounterId, list);
    return {
      ...c,
      orderId: res.body.data.id as string,
      items: res.body.data.items as { id: string }[],
    };
  }

  it('the ordering doctor cancels a placed order before collection, with a reason', async () => {
    const o = await placedOrder();
    const short = await post(o.doctor, `/lab-orders/${o.orderId}/cancel`, { reason: 'x' });
    expectError(short, 400, 'VALIDATION_ERROR');
    const res = await post(o.doctor, `/lab-orders/${o.orderId}/cancel`, {
      reason: 'Patient declined',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'Patient declined', by: o.doctor.id },
    });
    const [entry] = await auditEntries('lab_order.cancel');
    expect(entry!.metadata).toMatchObject({ reasonGiven: true, from: 'ordered' });
    expect(JSON.stringify(entry)).not.toMatch(/declined/);
    const again = await post(o.doctor, `/lab-orders/${o.orderId}/cancel`, { reason: 'Again' });
    expectError(again, 409, 'INVALID_STATUS_TRANSITION');
  });

  it('not after collection (409), but after a rejected sample; drafts are discarded instead', async () => {
    const doctor = await loginAsDoctor();
    const { id: patient } = await createPatient();
    const test = await createLabTest();
    const collected = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'sample_collected',
      tests: [test],
    });
    const res = await post(doctor, `/lab-orders/${collected._id}/cancel`, {
      reason: 'No longer needed',
    });
    expectError(res, 409, 'INVALID_STATUS_TRANSITION');
    expect(res.body.message).toMatch(/cancel single tests/);
    const rejected = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'sample_rejected',
      tests: [test],
    });
    expect(
      (await post(doctor, `/lab-orders/${rejected._id}/cancel`, { reason: 'Not coming back' }))
        .status,
    ).toBe(200);
    const draft = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'draft',
      tests: [test],
    });
    const d = await post(doctor, `/lab-orders/${draft._id}/cancel`, { reason: 'Not needed' });
    expectError(d, 409, 'INVALID_STATUS_TRANSITION');
    expect(d.body.message).toMatch(/discard/);
  });

  it('only the ordering doctor cancels an order (another doctor 404, lab tech 403)', async () => {
    const o = await placedOrder();
    const other = await loginAsDoctor();
    expectError(
      await post(other, `/lab-orders/${o.orderId}/cancel`, { reason: 'Mine now' }),
      404,
      'NOT_FOUND',
    );
    const lab = await loginAs('labtech');
    expect(
      (await post(lab, `/lab-orders/${o.orderId}/cancel`, { reason: 'Not mine' })).status,
    ).toBe(403);
  });

  it('single tests: a lab tech cancels one; cancelling the last one cancels the order', async () => {
    const o = await placedOrder();
    const lab = await loginAs('labtech');
    const [first, second] = o.items;
    const one = await post(lab, `/lab-orders/${o.orderId}/items/${first!.id}/cancel`, {
      reason: 'Reagent unavailable',
    });
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({
      status: 'ordered',
      items: [
        { status: 'cancelled', cancellation: { reason: 'Reagent unavailable' } },
        { status: 'pending' },
      ],
    });
    const twice = await post(lab, `/lab-orders/${o.orderId}/items/${first!.id}/cancel`, {
      reason: 'Again',
    });
    expectError(twice, 409, 'INVALID_STATUS_TRANSITION');
    // The ordering doctor may cancel single tests too.
    const last = await post(o.doctor, `/lab-orders/${o.orderId}/items/${second!.id}/cancel`, {
      reason: 'Not needed any more',
    });
    expect(last.body.data.status).toBe('cancelled');
    const stored = await LabOrder.findById(o.orderId).lean();
    expect(stored!.statusHistory.map((h) => h.status)).toEqual(['ordered', 'cancelled']);
    const entries = await auditEntries('lab_order.item_cancel');
    expect(entries.map((e) => e.metadata?.orderStatus)).toEqual(['ordered', 'cancelled']);
  });

  it('cancelling the last pending test while the others have results → result_entered', async () => {
    const doctor = await loginAsDoctor();
    const { id: patient } = await createPatient();
    const test = await createLabTest();
    const snap = {
      test: test._id,
      testSnapshot: { code: test.code, name: test.name, pricePaise: 1 },
    };
    const o = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'processing',
      items: [
        { ...snap, status: 'result_entered' },
        { ...snap, status: 'pending' },
      ],
    });
    const lab = await loginAs('labtech');
    const res = await post(lab, `/lab-orders/${o._id}/items/${o.items[1]!._id}/cancel`, {
      reason: 'Sample insufficient',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('result_entered');
    // A test with results cannot be cancelled.
    const entered = await post(lab, `/lab-orders/${o._id}/items/${o.items[0]!._id}/cancel`, {
      reason: 'Changed my mind',
    });
    expectError(entered, 409, 'INVALID_STATUS_TRANSITION');
  });

  it('refused on drafts, released orders, unknown items, and for doctors other than the orderer', async () => {
    const doctor = await loginAsDoctor();
    const { id: patient } = await createPatient();
    const test = await createLabTest();
    const lab = await loginAs('labtech');
    const draft = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'draft',
      tests: [test],
    });
    expect(
      (
        await post(doctor, `/lab-orders/${draft._id}/items/${draft.items[0]!._id}/cancel`, {
          reason: 'Nope',
        })
      ).status,
    ).toBe(409);
    // Lab techs never see drafts.
    expect(
      (
        await post(lab, `/lab-orders/${draft._id}/items/${draft.items[0]!._id}/cancel`, {
          reason: 'Nope',
        })
      ).status,
    ).toBe(404);
    const released = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'released',
      tests: [test],
    });
    expectError(
      await post(lab, `/lab-orders/${released._id}/items/${released.items[0]!._id}/cancel`, {
        reason: 'Nope',
      }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    const placed = await insertLabOrder({ patient, doctor: doctor.id, tests: [test] });
    expectError(
      await post(lab, `/lab-orders/${placed._id}/items/${released._id}/cancel`, { reason: 'Nope' }),
      404,
      'NOT_FOUND',
    );
    const other = await loginAsDoctor();
    expectError(
      await post(other, `/lab-orders/${placed._id}/items/${placed.items[0]!._id}/cancel`, {
        reason: 'Nope',
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('reading lab orders per role', () => {
  /** A patient (with a login and an allergy), their doctor, and orders in several statuses. */
  async function setup() {
    const patient = await loginAsPatient({
      allergies: [{ substance: 'Latex', severity: 'moderate' }],
      email: 'lab.patient@example.com',
    });
    const doctor = await loginAsDoctor();
    const test = await createLabTest({ name: 'Complete blood count' });
    const make = (status: string, extra: Record<string, unknown> = {}) =>
      insertLabOrder({
        patient: patient.patientId,
        doctor: doctor.id,
        status,
        tests: [test],
        ...extra,
      });
    const result = (value: number, flag: string) => ({
      parameterKey: 'hb',
      name: 'Haemoglobin',
      unit: 'g/dL',
      value,
      referenceText: '12–15.5 g/dL',
      flag,
    });
    const snap = {
      test: test._id,
      testSnapshot: { code: test.code, name: test.name, pricePaise: 25_000 },
    };
    const draft = await make('draft');
    const ordered = await make('ordered', { priority: 'urgent', clinicalNotes: 'Pallor, fatigue' });
    const processing = await make('processing', {
      items: [{ ...snap, status: 'pending', results: [result(9.1, 'low')] }],
    });
    const released = await make('released', {
      releasedAt: new Date(),
      items: [
        {
          ...snap,
          status: 'verified',
          results: [result(11.2, 'low')],
          remarks: 'Internal: repeat if symptomatic',
          resultVersion: 2,
          previousResults: [
            {
              version: 1,
              results: [result(10.2, 'low')],
              revisedAt: new Date(),
              reason: 'Transcription error',
            },
          ],
          pendingRevision: {
            results: [result(11.5, 'low')],
            reason: 'Recalibrated analyser',
            at: new Date(),
          },
        },
      ],
    });
    return { patient, doctor, test, draft, ordered, processing, released };
  }

  it('lab tech: every placed order (no drafts), urgent first then oldest; minimal patient view', async () => {
    const s = await setup();
    const lab = await loginAs('labtech');
    const list = await get(lab, '/lab-orders');
    expect(list.status).toBe(200);
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([
      s.ordered._id.toString(),
      s.processing._id.toString(),
      s.released._id.toString(),
    ]);
    const detail = await get(lab, `/lab-orders/${s.ordered._id}`);
    expect(Object.keys(detail.body.data.patient).sort()).toEqual([
      'age',
      'allergies',
      'fullName',
      'gender',
      'id',
      'mrn',
    ]);
    expect(detail.body.data.patient.allergies).toEqual([
      { substance: 'Latex', reaction: null, severity: 'moderate' },
    ]);
    expect(detail.body.data.clinicalNotes).toBe('Pallor, fatigue');
    expect(JSON.stringify(detail.body)).not.toMatch(/lab\.patient@example\.com|\+91/);
    // The lab sees pending revisions and old versions.
    const released = await get(lab, `/lab-orders/${s.released._id}`);
    expect(released.body.data.items[0]).toMatchObject({
      pendingRevision: { reason: 'Recalibrated analyser' },
      previousResults: [{ version: 1 }],
    });
    expect((await get(lab, `/lab-orders/${s.draft._id}`)).status).toBe(404);
  });

  it('lab tech filters: status list, priority, and q by order number, sample id, MRN or name', async () => {
    const s = await setup();
    await LabOrder.updateOne(
      { _id: s.processing._id },
      { $set: { 'sample.sampleId': 'S26-000042' } },
    );
    const lab = await loginAs('labtech');
    const ids = async (query: string) =>
      (await get(lab, `/lab-orders?${query}`)).body.data.map((o: { id: string }) => o.id);
    expect(await ids('status=ordered,processing')).toEqual([
      s.ordered._id.toString(),
      s.processing._id.toString(),
    ]);
    expect(await ids('priority=urgent')).toEqual([s.ordered._id.toString()]);
    expect(await ids(`q=${s.released.orderNumber!.toLowerCase()}`)).toEqual([
      s.released._id.toString(),
    ]);
    expect(await ids('q=s26-000042')).toEqual([s.processing._id.toString()]);
    const patient = await get(s.patient, '/patients/me');
    expect(await ids(`q=${patient.body.data.mrn}`)).toHaveLength(3);
    expect(await ids(`q=${patient.body.data.lastName.slice(0, 4)}`)).toHaveLength(3);
    expect(await ids('q=nobody')).toEqual([]);
    expectError(await get(lab, '/lab-orders?status=bogus'), 400, 'VALIDATION_ERROR');
  });

  it('doctor: own orders incl. drafts; results only once entered, marked unverified', async () => {
    const s = await setup();
    const list = await get(s.doctor, '/lab-orders');
    expect(list.body.data).toHaveLength(4);
    const processing = await get(s.doctor, `/lab-orders/${s.processing._id}`);
    expect(processing.body.data.items[0]).toMatchObject({
      resultsAvailable: false,
      results: [],
    });
    await LabOrder.updateOne(
      { _id: s.processing._id },
      { $set: { status: 'result_entered', 'items.0.status': 'result_entered' } },
    );
    const entered = await get(s.doctor, `/lab-orders/${s.processing._id}`);
    expect(entered.body.data.items[0]).toMatchObject({
      resultsAvailable: true,
      unverified: true,
      results: [{ parameterKey: 'hb', value: 9.1, flag: 'low' }],
    });
    const released = await get(s.doctor, `/lab-orders/${s.released._id}`);
    expect(released.body.data.items[0]).toMatchObject({
      unverified: false,
      revisionPending: true,
      previousResults: [{ version: 1 }],
      correctedAt: expect.any(String),
    });
    expect(released.body.data.items[0]).not.toHaveProperty('pendingRevision');
  });

  it('doctor: needsReview lists own result_entered/released orders not yet acknowledged', async () => {
    const s = await setup();
    await LabOrder.updateOne({ _id: s.processing._id }, { $set: { status: 'result_entered' } });
    const ids = async () =>
      (await get(s.doctor, '/lab-orders?needsReview=true')).body.data.map(
        (o: { id: string }) => o.id,
      );
    expect((await ids()).sort()).toEqual(
      [s.processing._id.toString(), s.released._id.toString()].sort(),
    );
    await LabOrder.updateOne({ _id: s.released._id }, { $set: { reviewedByDoctorAt: new Date() } });
    expect(await ids()).toEqual([s.processing._id.toString()]);
  });

  it('another doctor: only with a care relationship, never drafts', async () => {
    const s = await setup();
    const other = await loginAsDoctor();
    expect((await get(other, '/lab-orders')).body.data).toEqual([]);
    expectError(await get(other, `/lab-orders/${s.ordered._id}`), 404, 'NOT_FOUND');
    expectError(await get(other, `/lab-orders?patient=${s.patient.patientId}`), 404, 'NOT_FOUND');
    // An order of their own for the patient creates the relationship.
    await insertLabOrder({ patient: s.patient.patientId, doctor: other.id, tests: [s.test] });
    const list = await get(other, `/lab-orders?patient=${s.patient.patientId}`);
    expect(list.body.data).toHaveLength(4); // 3 placed of the first doctor + their own
    expect((await get(other, `/lab-orders/${s.ordered._id}`)).status).toBe(200);
    expect((await get(other, `/lab-orders/${s.draft._id}`)).status).toBe(404);
  });

  it('receptionist: status only, for a named patient or appointment; no results or notes', async () => {
    const s = await setup();
    const reception = await loginAs('receptionist');
    expectError(await get(reception, '/lab-orders'), 400, 'VALIDATION_ERROR');
    const list = await get(reception, `/lab-orders?patient=${s.patient.patientId}`);
    expect(list.body.data).toHaveLength(3);
    const detail = await get(reception, `/lab-orders/${s.released._id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      status: 'released',
      tests: [{ code: s.test.code, pricePaise: 25_000, cancelled: false }],
    });
    const text = JSON.stringify([list.body, detail.body]);
    expect(text).not.toMatch(/results|clinicalNotes|Pallor|Haemoglobin|remarks|sample/);
    expect((await get(reception, `/lab-orders/${s.draft._id}`)).status).toBe(404);
  });

  it('patient: own released orders only, the current version without internal details', async () => {
    const s = await setup();
    const list = await get(s.patient, '/lab-orders');
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([s.released._id.toString()]);
    expect(list.body.data[0]).toMatchObject({ corrected: true });
    expectError(await get(s.patient, `/lab-orders/${s.ordered._id}`), 404, 'NOT_FOUND');
    const detail = await get(s.patient, `/lab-orders/${s.released._id}`);
    expect(detail.body.data.items).toEqual([
      expect.objectContaining({
        results: [expect.objectContaining({ value: 11.2, flag: 'low' })],
        resultVersion: 2,
        correctedAt: expect.any(String),
      }),
    ]);
    const text = JSON.stringify(detail.body);
    expect(text).not.toMatch(/remarks|Internal|previousResults|pendingRevision|clinicalNotes/);
    // Only the released value – not the old version (10.2) or the pending revision (11.5).
    const values = detail.body.data.items.flatMap((i: { results: { value: unknown }[] }) =>
      i.results.map((r) => r.value),
    );
    expect(values).toEqual([11.2]);
    const someoneElse = await loginAsPatient();
    expectError(await get(someoneElse, `/lab-orders/${s.released._id}`), 404, 'NOT_FOUND');
  });

  it('admins get no lab order endpoints; reads are audited once per 5 minutes', async () => {
    const s = await setup();
    const admin = await loginAs('admin');
    expect((await get(admin, '/lab-orders')).status).toBe(403);
    expect((await get(admin, `/lab-orders/${s.released._id}`)).status).toBe(403);
    await get(s.doctor, `/lab-orders/${s.released._id}`);
    await get(s.doctor, `/lab-orders/${s.released._id}`);
    const views = await auditEntries('lab_order.view');
    expect(views).toHaveLength(1);
    expect(views[0]!.patient!.toString()).toBe(s.patient.patientId);
  });
});

describe('catalogue snapshot', () => {
  it('orders keep the name and price they were ordered with', async () => {
    const c = await signedConsultation();
    const test = await createLabTest({ name: 'Lipid profile', pricePaise: 50_000 });
    const res = await order(c.doctor, c.encounterId, [test]);
    await LabTest.updateOne(
      { _id: test._id },
      { $set: { name: 'Lipid panel', pricePaise: 70_000 } },
    );
    const reception = await loginAs('receptionist');
    const view = await get(reception, `/lab-orders/${res.body.data.id}`);
    expect(view.body.data.tests[0]).toMatchObject({ name: 'Lipid profile', pricePaise: 50_000 });
  });
});
