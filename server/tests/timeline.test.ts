import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Document as DocumentModel } from '../src/modules/documents/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { encodeCursor } from '../src/modules/timeline/cursor.js';
import { auditEntries, createUser, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import {
  createPatient,
  insertAppointment,
  insertLabOrder,
  loginAsDoctor,
  loginAsPatient,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Patient timeline (spec §8.8, Phase 8): per-role sources filtered before merging, cursor pages
 * over mixed sources with identical times, type and date filters.
 */

/** Clinical text that must never reach reception, and history/exam text never the patient. */
const SECRET = /SECRET|Acute pharyngitis/;

const T = new Date('2026-03-10T05:00:00.000Z');
const EARLY = new Date('2025-01-15T05:00:00.000Z');

let seq = 0;
const num = (prefix: string) => `${prefix}-1999-${String(++seq).padStart(6, '0')}`;

interface Setup {
  doctor: LoggedIn & { id: string };
  patient: LoggedIn & { patientId: string };
  reception: LoggedIn;
  patientId: string;
}

/**
 * One patient with every kind of record at the same instant T (plus one early appointment), and
 * the hidden ones each role must not see: a draft note, a draft prescription, a draft and an
 * unreleased lab order, a draft invoice, a document not visible to the patient, a doctor's
 * clinical upload.
 */
async function setup(): Promise<Setup> {
  const doctor = await loginAsDoctor();
  const patient = await loginAsPatient();
  const reception = await loginAs('receptionist');
  const patientId = patient.patientId;
  const staff = await createUser('receptionist');

  const visit = await insertAppointment({
    patient: patientId,
    doctor: doctor.id,
    startAt: T,
    status: 'completed',
    isSlotActive: false,
  });
  await insertAppointment({
    patient: patientId,
    doctor: doctor.id,
    startAt: EARLY,
    status: 'cancelled',
    isSlotActive: false,
  });
  const draftVisit = await insertAppointment({
    patient: patientId,
    doctor: doctor.id,
    startAt: new Date(T.getTime() - 86_400_000),
    status: 'completed',
    isSlotActive: false,
  });
  const note = {
    patient: patientId,
    doctor: doctor.id,
    chiefComplaint: 'SECRET complaint',
    historyOfPresentIllness: 'SECRET history',
    examination: 'SECRET examination',
    assessment: 'SECRET assessment',
    plan: 'SECRET plan',
    diagnoses: [{ description: 'Acute pharyngitis', isPrimary: true }],
  };
  const signed = await Encounter.create({
    ...note,
    encounterNumber: num('ENC'),
    appointment: visit._id,
    visitAt: T,
    status: 'signed',
    signedAt: T,
    signedBy: doctor.id,
    followUp: { required: true, afterDays: 7 },
  });
  await Encounter.create({
    ...note,
    encounterNumber: num('ENC'),
    appointment: draftVisit._id,
    visitAt: draftVisit.startAt,
  });

  const rx = {
    patient: patientId,
    doctor: doctor.id,
    encounter: signed._id,
    appointment: visit._id,
    items: [{ drugName: 'SECRET drug', dose: '1', frequency: 'OD', durationDays: 3 }],
  };
  await Prescription.create({
    ...rx,
    status: 'issued',
    prescriptionNumber: num('RX'),
    issuedAt: T,
  });
  await Prescription.create({
    ...rx,
    encounter: new Types.ObjectId(),
    appointment: new Types.ObjectId(),
  });

  const tests = [{ _id: new Types.ObjectId(), code: 'CBC', name: 'SECRET CBC', pricePaise: 100 }];
  const lab = { patient: patientId, doctor: doctor.id, tests, encounter: signed._id };
  await insertLabOrder({ ...lab, status: 'released', orderedAt: T, releasedAt: T });
  await insertLabOrder({ ...lab, status: 'processing', orderedAt: T });
  await insertLabOrder({ ...lab, status: 'draft' });

  const line = {
    kind: 'other',
    origin: 'staff',
    description: 'Consultation',
    quantity: 1,
    unitPricePaise: 85_000,
    discountPaise: 0,
    taxRateBps: 0,
    taxPaise: 0,
    lineTotalPaise: 85_000,
  };
  const invoiceBase = {
    kind: 'manual',
    patient: patientId,
    items: [line],
    subtotalPaise: 85_000,
    totalPaise: 85_000,
  };
  const [paid] = await Invoice.create([
    {
      ...invoiceBase,
      status: 'paid',
      invoiceNumber: num('INV'),
      issuedAt: T,
      amountPaidPaise: 85_000,
      balancePaise: 0,
    },
    { ...invoiceBase, status: 'draft', balancePaise: 85_000 },
  ]);
  const payment = await Payment.create({
    paymentNumber: num('PAY'),
    invoice: paid!._id,
    patient: patientId,
    amountPaise: 85_000,
    method: 'upi',
    reference: 'UPI123456',
    kind: 'payment',
    receivedBy: staff._id,
    receivedAt: T,
  });
  await Payment.create({
    paymentNumber: num('PAY'),
    invoice: paid!._id,
    patient: patientId,
    amountPaise: -5_000,
    method: 'cash',
    kind: 'refund',
    refundOf: payment._id,
    reason: 'Overcharged',
    receivedBy: staff._id,
    receivedAt: T,
  });

  const doc = {
    patient: patientId,
    mimeType: 'application/pdf',
    sizeBytes: 10,
    storageDriver: 'local',
    storageKey: 'unused',
    checksumSha256: 'c'.repeat(64),
    originalName: 'x.pdf',
  };
  const docs = await DocumentModel.create([
    {
      ...doc,
      category: 'lab_report',
      title: 'Lab report',
      isGenerated: true,
      visibleToPatient: true,
    },
    { ...doc, category: 'id_proof', title: 'Aadhaar card', uploadedByRole: 'receptionist' },
    { ...doc, category: 'referral', title: 'SECRET referral', uploadedByRole: 'doctor' },
    { ...doc, category: 'other', title: 'Deleted', isDeleted: true, visibleToPatient: true },
  ]);
  await DocumentModel.collection.updateMany(
    { _id: { $in: docs.map((d) => d._id) } },
    { $set: { createdAt: T } },
  );
  return { doctor, patient, reception, patientId };
}

const timeline = (who: LoggedIn, path: string) => api().get(`/api/v1${path}`).set(who.auth);
const typesOf = (items: { type: string }[]) => [...new Set(items.map((i) => i.type))].sort();

beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init(), LabOrder.init()]);
});

describe('GET /patients/:id/timeline – per role', () => {
  it('reception gets appointments, invoices, payments and non-clinical documents only', async () => {
    const s = await setup();
    const res = await timeline(s.reception, `/patients/${s.patientId}/timeline?limit=50`);
    expect(res.status).toBe(200);
    const items = res.body.data as { type: string; title: string; flags: string[] }[];
    expect(typesOf(items)).toEqual(['appointment', 'document', 'invoice', 'payment']);
    expect(items.filter((i) => i.type === 'document').map((i) => i.title)).toEqual([
      'Aadhaar card',
    ]);
    expect(items.filter((i) => i.type === 'appointment')).toHaveLength(3);
    expect(items.find((i) => i.type === 'invoice')).toMatchObject({
      subtitle: '₹850.00 paid',
      status: 'paid',
      link: expect.stringMatching(/^\/reception\/invoices\//),
    });
    const refund = items.find((i) => i.flags.includes('refund'));
    expect(refund).toMatchObject({ status: 'refund', title: expect.stringMatching(/^Refund /) });
    expect(JSON.stringify(res.body)).not.toMatch(SECRET);
    expect(JSON.stringify(res.body)).not.toMatch(/UPI123456/);
    expect(res.body.meta).toEqual({ limit: 50, nextCursor: null });
  });

  it('a related doctor gets clinical items and appointments, no billing and no drafts', async () => {
    const s = await setup();
    const res = await timeline(s.doctor, `/patients/${s.patientId}/timeline?limit=50`);
    expect(res.status).toBe(200);
    const items = res.body.data as { type: string; subtitle: string; status: string }[];
    expect(typesOf(items)).toEqual([
      'appointment',
      'document',
      'encounter',
      'lab_order',
      'prescription',
    ]);
    // One signed note (with its primary diagnosis), one issued prescription, two placed orders.
    const notes = items.filter((i) => i.type === 'encounter');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.subtitle).toContain('Acute pharyngitis');
    expect(items.filter((i) => i.type === 'prescription')).toHaveLength(1);
    expect(
      items
        .filter((i) => i.type === 'lab_order')
        .map((i) => i.status)
        .sort(),
    ).toEqual(['processing', 'released']);
    // Every document of the patient except the deleted one.
    expect(items.filter((i) => i.type === 'document')).toHaveLength(3);
  });

  it('the patient sees only released, issued and visible items of their own', async () => {
    const s = await setup();
    const res = await timeline(s.patient, '/patients/me/timeline?limit=50');
    expect(res.status).toBe(200);
    const items = res.body.data as { type: string; status: string; title: string }[];
    expect(typesOf(items)).toEqual([
      'appointment',
      'document',
      'encounter',
      'invoice',
      'lab_order',
      'payment',
      'prescription',
    ]);
    expect(items.filter((i) => i.type === 'encounter')).toEqual([
      expect.objectContaining({
        title: 'Visit summary',
        link: expect.stringMatching(/^\/patient\/visits\//),
      }),
    ]);
    expect(items.filter((i) => i.type === 'lab_order').map((i) => i.status)).toEqual(['released']);
    expect(items.filter((i) => i.type === 'invoice').map((i) => i.status)).toEqual(['paid']);
    expect(items.filter((i) => i.type === 'payment')).toHaveLength(2);
    expect(items.filter((i) => i.type === 'document').map((i) => i.title)).toEqual(['Lab report']);
    // No history, examination or unshared diagnosis (test names on the released report are fine).
    expect(JSON.stringify(res.body)).not.toMatch(
      /SECRET (complaint|history|examination|assessment|plan|referral)|Acute pharyngitis/,
    );
  });

  it('shows the diagnosis to the patient only when the doctor shared it', async () => {
    const s = await setup();
    await Encounter.collection.updateOne(
      { status: 'signed' },
      { $set: { shareDiagnosisWithPatient: true } },
    );
    const res = await timeline(s.patient, '/patients/me/timeline?types=encounter');
    expect(res.body.data[0].subtitle).toContain('Acute pharyngitis');
  });

  it('admins, lab technicians and patients get 403; a doctor without a relationship 404', async () => {
    const s = await setup();
    for (const role of ['admin', 'labtech'] as const) {
      const who = await loginAs(role);
      const res = await timeline(who, `/patients/${s.patientId}/timeline`);
      expect(res.status, role).toBe(403);
    }
    expect((await timeline(s.patient, `/patients/${s.patientId}/timeline`)).status).toBe(403);
    const stranger = await loginAsDoctor();
    const res = await timeline(stranger, `/patients/${s.patientId}/timeline`);
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
    // Reception gets 404 for a patient that does not exist.
    const missing = await timeline(s.reception, `/patients/${new Types.ObjectId()}/timeline`);
    expect(missing.status).toBe(404);
  });

  it('a patient whose sign-up is still pending gets 403 PATIENT_LINK_PENDING', async () => {
    const { id } = await createPatient();
    const pending = await loginAs('patient', {
      patient: id,
      patientLinkStatus: 'pending_verification',
    });
    const res = await timeline(pending, '/patients/me/timeline');
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'PATIENT_LINK_PENDING');
  });

  it('is audited as patient.timeline_view (debounced)', async () => {
    const s = await setup();
    await timeline(s.reception, `/patients/${s.patientId}/timeline`);
    await timeline(s.reception, `/patients/${s.patientId}/timeline`);
    const entries = await auditEntries('patient.timeline_view');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.patient?.toString()).toBe(s.patientId);
  });
});

describe('GET /patients/:id/timeline – cursor pages and filters', () => {
  it('pages over mixed sources with identical times return every item once, in order', async () => {
    const s = await setup();
    const all = await timeline(s.patient, '/patients/me/timeline?limit=50');
    const expected = (all.body.data as { type: string; id: string }[]).map(
      (i) => `${i.type}:${i.id}`,
    );
    expect(expected.length).toBeGreaterThanOrEqual(9);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await timeline(
        s.patient,
        `/patients/me/timeline?limit=4${cursor ? `&before=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(4);
      seen.push(
        ...(res.body.data as { type: string; id: string }[]).map((i) => `${i.type}:${i.id}`),
      );
      cursor = res.body.meta.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);

    // Newest first; on equal times by type then id, both descending.
    const at = (all.body.data as { at: string }[]).map((i) => new Date(i.at).getTime());
    expect([...at].sort((a, b) => b - a)).toEqual(at);
  });

  it('filters by type and by clinic date', async () => {
    const s = await setup();
    const billing = await timeline(
      s.reception,
      `/patients/${s.patientId}/timeline?types=invoice,payment`,
    );
    expect(typesOf(billing.body.data)).toEqual(['invoice', 'payment']);
    // A type the role may not see is simply empty.
    const notes = await timeline(s.reception, `/patients/${s.patientId}/timeline?types=encounter`);
    expect(notes.body.data).toEqual([]);

    const early = await timeline(
      s.reception,
      `/patients/${s.patientId}/timeline?types=appointment&from=2025-01-01&to=2025-12-31`,
    );
    expect(early.body.data).toHaveLength(1);
    expect(early.body.data[0].status).toBe('cancelled');
    const late = await timeline(
      s.reception,
      `/patients/${s.patientId}/timeline?types=appointment&from=2026-01-01`,
    );
    expect(late.body.data).toHaveLength(2);
  });

  it('rejects a cursor it did not make and bad filters (400)', async () => {
    const s = await setup();
    for (const query of [
      'before=not-a-cursor',
      `before=${Buffer.from('2026-01-01|nope|abc').toString('base64url')}`,
      'types=diagnosis',
      'limit=51',
      'from=2026-02-01&to=2026-01-01',
    ]) {
      const res = await timeline(s.reception, `/patients/${s.patientId}/timeline?${query}`);
      expect(res.status, query).toBe(400);
      expectErrorShape(res.body, 'VALIDATION_ERROR');
    }
    const valid = encodeCursor({ at: T, type: 'invoice', id: new Types.ObjectId().toString() });
    const ok = await timeline(s.reception, `/patients/${s.patientId}/timeline?before=${valid}`);
    expect(ok.status).toBe(200);
  });
});
