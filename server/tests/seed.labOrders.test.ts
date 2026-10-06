import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config/env.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Document } from '../src/modules/documents/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { User } from '../src/modules/users/model.js';
import { runSeed } from '../src/seed/index.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { isPdf, pdfText } from './helpers/pdf.js';
import { api } from './helpers/testApp.js';
import { DEMO_PASSWORD } from '../src/seed/users.js';

/** Lab orders and documents of the demo seed (spec §15.3, Phase 6). */

let summary: Awaited<ReturnType<typeof runSeed>>;
let emails: ReturnType<typeof captureEmails>;
beforeAll(async () => {
  await Promise.all([
    DoctorProfile.init(),
    DoctorSchedule.init(),
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    NoteAmendment.init(),
    LabOrder.init(),
  ]);
  await resetDb();
  emails = captureEmails();
  summary = await runSeed();
  emails.restore();
}, 120_000);

const login = async (email: string) => {
  const res = await api().post('/api/v1/auth/login').send({ email, password: DEMO_PASSWORD });
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
};

describe('seeded lab orders', () => {
  it('the planned spread of statuses, from notes whose diagnosis suits the tests', async () => {
    expect(summary.labOrders).toMatchObject({
      created: 80,
      ordered: 3,
      sample_rejected: 2,
      sample_collected: 5,
      processing: 5,
      result_entered: 5,
      verified: 5,
      released: 55,
      criticals: 3,
      revised: 1,
      cancelledTests: 3,
    });
    expect(await LabOrder.countDocuments({ priority: 'urgent', status: 'ordered' })).toBe(1);
    const orders = await LabOrder.find().lean();
    for (const o of orders) {
      const note = await Encounter.findById(o.encounter).select('doctor patient status').lean();
      expect(note).toMatchObject({ doctor: o.orderedBy, patient: o.patient });
      expect(['signed', 'amended']).toContain(note!.status);
      expect(o.orderNumber).toMatch(/^LAB-\d{4}-\d{6}$/);
    }
  });

  it('results awaiting verification were entered by lab1, so lab2 can verify them', async () => {
    const lab1 = await User.findOne({ email: 'lab1@medassist.dev' }).lean();
    const waiting = await LabOrder.find({ status: 'result_entered' }).lean();
    expect(waiting).toHaveLength(5);
    for (const o of waiting) {
      for (const i of o.items.filter((x) => x.status !== 'cancelled')) {
        expect(i.enteredBy).toEqual(lab1!._id);
      }
    }
    const lab2 = await login('lab2@medassist.dev');
    const verify = await api().post(`/api/v1/lab-orders/${waiting[0]!._id}/verify`).set(lab2);
    expect(verify.status).toBe(200);
  });

  it('every released order has its PDF; mostly normal results, a few out of range, three criticals', async () => {
    const released = await LabOrder.find({ status: 'released' }).lean();
    const flags = released.flatMap((o) => o.items.flatMap((i) => i.results.map((r) => r.flag)));
    const numeric = flags.filter((f) => f !== 'na' && f !== 'abnormal');
    const outOfRange = numeric.filter((f) => f !== 'normal').length / numeric.length;
    expect(outOfRange).toBeGreaterThan(0.05);
    expect(outOfRange).toBeLessThan(0.35);
    const criticalOrders = await LabOrder.countDocuments({ hasCritical: true });
    expect(criticalOrders).toBe(3);
    for (const o of released.slice(0, 5)) {
      const doc = await Document.findById(o.reportDocument).select('+storageKey').lean();
      expect(doc).toMatchObject({
        category: 'lab_report',
        isGenerated: true,
        visibleToPatient: true,
      });
      const pdf = await readFile(
        path.join(config.storage.uploadDir, ...doc!.storageKey.split('/')),
      );
      expect(isPdf(pdf)).toBe(true);
      expect(pdfText(pdf)).toContain(o.orderNumber!);
    }
    const revised = await LabOrder.find({ 'items.resultVersion': 2 }).lean();
    expect(revised).toHaveLength(1);
    expect(await Document.countDocuments({ 'linked.id': revised[0]!._id })).toBe(2);
  });

  it('patient1 sees a released report; some released results wait for review', async () => {
    const patient1 = await login('patient1@medassist.dev');
    const list = await api().get('/api/v1/lab-orders').set(patient1);
    expect(list.body.data.length).toBeGreaterThan(0);
    const report = await api()
      .get(`/api/v1/lab-orders/${list.body.data[0].id}/report.pdf`)
      .set(patient1)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(report.status).toBe(200);
    expect(isPdf(report.body as Buffer)).toBe(true);

    const released = await LabOrder.countDocuments({ status: 'released' });
    const acknowledged = await LabOrder.countDocuments({
      status: 'released',
      reviewedByDoctorAt: { $ne: null },
    });
    expect(acknowledged).toBeGreaterThan(released * 0.4);
    expect(acknowledged).toBeLessThan(released);
  });

  it('uploaded demo documents; no emails were sent', async () => {
    expect(summary.documents).toEqual({ created: 3, unchanged: 0 });
    const p1 = await Patient.findOne({
      user: (await User.findOne({ email: 'patient1@medassist.dev' }))!._id,
    });
    const docs = await Document.find({ patient: p1!._id, isGenerated: false }).lean();
    expect(docs.map((d) => [d.category, d.mimeType]).sort()).toEqual([
      ['id_proof', 'image/png'],
      ['referral', 'application/pdf'],
    ]);
    expect(emails.sent).toEqual([]);
  });
});
