import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config/env.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Document } from '../src/modules/documents/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { logger } from '../src/utils/logger.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createLabTest,
  createPatient,
  readyToSign,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { isPdf, pdfText } from './helpers/pdf.js';
import { api } from './helpers/testApp.js';

/**
 * The lab report PDF (spec §4.8, §12.3): generated on release and on every applied revision,
 * stored as a generated Document, served by GET /lab-orders/:id/report.pdf.
 */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init(), LabOrder.init()]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => {
  emails.restore();
  vi.restoreAllMocks();
});

const post = (who: LoggedIn, p: string, body: object = {}) =>
  api().post(`/api/v1${p}`).set(who.auth).send(body);
const binary = (who: LoggedIn, p: string) =>
  api()
    .get(`/api/v1${p}`)
    .set(who.auth)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

/** A verified order (hb 4.2 critical + smear) for a patient with a login; two lab techs. */
async function verifiedOrder() {
  const { id: patientId } = await createPatient({
    firstName: 'Kavya',
    lastName: 'Rao',
    gender: 'female',
  });
  const patient = await loginAs('patient', { patient: patientId, patientLinkStatus: 'linked' });
  await Patient.updateOne({ _id: patientId }, { $set: { user: patient.user._id } });
  const c = await readyToSign({ patientId, items: [] });
  await signNote(c.doctor, c.encounterId);
  const test = await createLabTest({ name: 'Complete blood count', code: 'CBC' });
  const created = await post(c.doctor, '/lab-orders', {
    encounterId: c.encounterId,
    testIds: [test._id.toString()],
  });
  const orderId = created.body.data.id as string;
  const itemId = created.body.data.items[0].id as string;
  const lab1 = await loginAs('labtech', { firstName: 'Asha', lastName: 'Menon' });
  const lab2 = await loginAs('labtech', { firstName: 'Ravi', lastName: 'Iyer' });
  await post(lab1, `/lab-orders/${orderId}/collect-sample`);
  await post(lab1, `/lab-orders/${orderId}/start-processing`);
  await api()
    .put(`/api/v1/lab-orders/${orderId}/items/${itemId}/results`)
    .set(lab1.auth)
    .send({
      results: [
        { parameterKey: 'hb', value: 4.2 },
        { parameterKey: 'smear', value: 'Negative' },
      ],
      remarks: 'Repeat sample advised',
    });
  expect((await post(lab2, `/lab-orders/${orderId}/verify`)).status).toBe(200);
  const orderNumber = created.body.data.orderNumber as string;
  return { ...c, patient, patientId, orderId, itemId, orderNumber, lab1, lab2 };
}

async function readStored(documentId: unknown) {
  const d = await Document.findById(documentId).select('+storageKey').lean();
  return readFile(path.join(config.storage.uploadDir, ...d!.storageKey.split('/')));
}

describe('on release', () => {
  it('generates the PDF, stores it as a generated lab report and links it to the order', async () => {
    const s = await verifiedOrder();
    expect((await binary(s.doctor, `/lab-orders/${s.orderId}/report.pdf`)).status).toBe(404);
    const res = await post(s.lab2, `/lab-orders/${s.orderId}/release`);
    expect(res.body.data.reportAvailable).toBe(true);

    const order = await LabOrder.findById(s.orderId).lean();
    const doc = await Document.findById(order!.reportDocument).lean();
    expect(doc).toMatchObject({
      patient: order!.patient,
      category: 'lab_report',
      isGenerated: true,
      visibleToPatient: true,
      mimeType: 'application/pdf',
      linked: { type: 'lab_order', id: order!._id },
      title: `Lab report ${s.orderNumber}`,
      originalName: `lab-report-${s.orderNumber}.pdf`,
    });

    const pdf = await readStored(doc!._id);
    expect(isPdf(pdf)).toBe(true);
    expect(doc!.sizeBytes).toBe(pdf.length);
    const text = pdfText(pdf);
    for (const expected of [
      'Laboratory report',
      s.orderNumber,
      'Kavya Rao',
      'MRN-',
      'Complete blood count (CBC)',
      'Haemoglobin',
      '4.2',
      'CRITICAL LOW **',
      'Verified by Ravi Iyer',
      'Released by Ravi Iyer',
      '*** End of report ***',
      'Page 1 of 1',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // Remarks are internal: never on the patient-visible report (D127).
    expect(text).not.toContain('Repeat sample advised');
  });

  it('GET /lab-orders/:id/report.pdf streams it to the doctor, the lab and the patient (audited)', async () => {
    const s = await verifiedOrder();
    await post(s.lab2, `/lab-orders/${s.orderId}/release`);
    for (const who of [s.doctor, s.lab1, s.patient]) {
      const res = await binary(who, `/lab-orders/${s.orderId}/report.pdf`);
      expect(res.status, who.user.role).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="lab-report-${s.orderNumber}.pdf"`,
      );
      expect(isPdf(res.body as Buffer)).toBe(true);
    }
    const entries = await auditEntries('document.download');
    expect(entries).toHaveLength(3);
    expect(entries[0]!.metadata).toMatchObject({ via: 'lab_order_report', category: 'lab_report' });

    const other = await loginAs('patient', {
      patient: (await createPatient()).id,
      patientLinkStatus: 'linked',
    });
    expect((await binary(other, `/lab-orders/${s.orderId}/report.pdf`)).status).toBe(404);
    const reception = await loginAs('receptionist');
    expect((await binary(reception, `/lab-orders/${s.orderId}/report.pdf`)).status).toBe(403);
    // The patient also finds it among their documents.
    const docs = await api().get('/api/v1/documents').set(s.patient.auth);
    expect(docs.body.data.map((d: { category: string }) => d.category)).toEqual(['lab_report']);
  });

  it('a failed release transaction logs the orphaned file and changes nothing', async () => {
    const s = await verifiedOrder();
    const errors: unknown[][] = [];
    vi.spyOn(logger, 'error').mockImplementation(((...args: unknown[]) => {
      errors.push(args);
    }) as never);
    vi.spyOn(Document, 'updateMany').mockRejectedValueOnce(new Error('disk on fire'));
    const res = await post(s.lab2, `/lab-orders/${s.orderId}/release`);
    expect(res.status).toBe(500);
    expect((await LabOrder.findById(s.orderId).lean())!.status).toBe('verified');
    expect(await Document.countDocuments()).toBe(0);
    const orphan = errors.find(
      (a) => a[1] === 'Orphaned file: stored, but its document record was not saved',
    );
    expect(orphan).toBeDefined();
    const { storageKey } = orphan![0] as { storageKey: string };
    const onDisk = await readFile(path.join(config.storage.uploadDir, ...storageKey.split('/')));
    expect(isPdf(onDisk)).toBe(true);
    // Retrying works.
    vi.restoreAllMocks();
    expect((await post(s.lab2, `/lab-orders/${s.orderId}/release`)).status).toBe(200);
  });
});

describe('on revision', () => {
  it('a new PDF (version 2) becomes the current report; the old one stays, hidden from the patient', async () => {
    const s = await verifiedOrder();
    await post(s.lab2, `/lab-orders/${s.orderId}/release`);
    const first = (await LabOrder.findById(s.orderId).lean())!.reportDocument!;
    await post(s.lab1, `/lab-orders/${s.orderId}/items/${s.itemId}/revise`, {
      results: [
        { parameterKey: 'hb', value: 12.4 },
        { parameterKey: 'smear', value: 'Negative' },
      ],
      reason: 'Transcription error',
    });
    // Still the first report while the revision waits.
    expect((await LabOrder.findById(s.orderId).lean())!.reportDocument).toEqual(first);
    await post(s.lab2, `/lab-orders/${s.orderId}/items/${s.itemId}/verify-revision`);

    const order = await LabOrder.findById(s.orderId).lean();
    expect(order!.reportDocument).not.toEqual(first);
    const [oldDoc, newDoc] = await Promise.all([
      Document.findById(first).lean(),
      Document.findById(order!.reportDocument).lean(),
    ]);
    expect(oldDoc).toMatchObject({ visibleToPatient: false, isDeleted: false });
    expect(newDoc).toMatchObject({
      visibleToPatient: true,
      title: `Lab report ${s.orderNumber} (version 2)`,
      originalName: `lab-report-${s.orderNumber}-v2.pdf`,
    });
    const text = pdfText(await readStored(newDoc!._id));
    expect(text).toMatch(/Revised report . version 2/);
    expect(text).toContain('12.4');
    expect(text).not.toContain('4.2');

    const patientDocs = await api().get('/api/v1/documents').set(s.patient.auth);
    expect(patientDocs.body.data.map((d: { id: string }) => d.id)).toEqual([
      order!.reportDocument!.toString(),
    ]);
    const staffDocs = await api()
      .get(`/api/v1/documents?patient=${s.patientId}`)
      .set(s.doctor.auth);
    expect(staffDocs.body.data).toHaveLength(2);
    const current = await binary(s.patient, `/lab-orders/${s.orderId}/report.pdf`);
    expect(pdfText(current.body as Buffer)).toContain('12.4');
  });
});
