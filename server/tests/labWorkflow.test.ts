import type { Server } from 'socket.io';
import { runLabTatJob } from '../src/jobs/labTat.job.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { clinicToday } from '../src/utils/dates.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createLabTest,
  createPatient,
  insertLabOrder,
  loginAsDoctor,
  readyToSign,
  setSettings,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * The lab workflow, step 2 (spec §4.8, §5.4, §7.14, §8.7, §8.11): sample collection, rejection
 * and recollection, result entry with server flags and critical alerts, dual verification,
 * send-back, release, revisions after release, the doctor's acknowledgement and the TAT job.
 */

let emails: ReturnType<typeof captureEmails>;
let events: [unknown, string, unknown][];
let tz: string;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init(), LabOrder.init()]);
  tz = await useMiddayClinicZone();
  emails = captureEmails();
  events = [];
  setSocketServer({
    to: (rooms: unknown) => ({
      emit: (e: string, p: unknown) => events.push([rooms, e, p]),
    }),
  } as unknown as Server);
});
afterEach(() => {
  emails.restore();
  setSocketServer(null);
});

function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return expectErrorShape(res.body, code);
}
const post = (who: LoggedIn, path: string, body: object = {}) =>
  api().post(`/api/v1${path}`).set(who.auth).send(body);
const put = (who: LoggedIn, path: string, body: object) =>
  api().put(`/api/v1${path}`).set(who.auth).send(body);
const get = (who: LoggedIn, path: string) => api().get(`/api/v1${path}`).set(who.auth);
const yy = () => clinicToday(tz).slice(2, 4);

/** Words of the clinical content below – never in emails, audit entries or socket payloads. */
const CLINICAL = /Haemoglobin|Malaria|smear|Positive|critical_|\b4\.2\b|\b5\.1\b|Lab test \d/i;

/**
 * A placed order (signed note) for an adult male patient with a login, one test with a numeric
 * (hb) and an option (smear) parameter; two lab technicians.
 */
async function placedOrder(patientOverrides: Record<string, unknown> = {}) {
  const patient = await createPatient({
    gender: 'male',
    dateOfBirth: '1980-01-01',
    email: 'lab.patient@example.com',
    ...patientOverrides,
  });
  const patientUser = await loginAs('patient', {
    patient: patient.id,
    patientLinkStatus: 'linked',
  });
  await Patient.updateOne({ _id: patient.id }, { $set: { user: patientUser.user._id } });
  const c = await readyToSign({ patientId: patient.id, items: [] });
  await signNote(c.doctor, c.encounterId);
  const test = await createLabTest();
  const res = await post(c.doctor, '/lab-orders', {
    encounterId: c.encounterId,
    testIds: [test._id.toString()],
  });
  expect(res.status).toBe(201);
  return {
    ...c,
    patient: patientUser,
    test,
    orderId: res.body.data.id as string,
    itemId: res.body.data.items[0].id as string,
    lab1: await loginAs('labtech'),
    lab2: await loginAs('labtech'),
  };
}
type Setup = Awaited<ReturnType<typeof placedOrder>>;

const hb = (value: unknown, extra: object = {}) => ({ parameterKey: 'hb', value, ...extra });
const smear = (value: unknown) => ({ parameterKey: 'smear', value });

/** Collects the sample and starts processing (lab1). */
async function processing(s: Setup) {
  expect((await post(s.lab1, `/lab-orders/${s.orderId}/collect-sample`)).status).toBe(200);
  expect((await post(s.lab1, `/lab-orders/${s.orderId}/start-processing`)).status).toBe(200);
}

/** Enters complete results as `who` (default lab1). */
const enter = (s: Setup, results: object[], who: LoggedIn = s.lab1, remarks?: string) =>
  put(who, `/lab-orders/${s.orderId}/items/${s.itemId}/results`, {
    results,
    ...(remarks ? { remarks } : {}),
  });

/** processing → entered (lab1) → verified (lab2) → released (lab2). */
async function released(s: Setup) {
  await processing(s);
  expect((await enter(s, [hb(14.2), smear('Negative')])).status).toBe(200);
  expect((await post(s.lab2, `/lab-orders/${s.orderId}/verify`)).status).toBe(200);
  expect((await post(s.lab2, `/lab-orders/${s.orderId}/release`)).status).toBe(200);
}

describe('the full path ordered → released', () => {
  it('collect, process, partial and complete entry, verify, release; the patient sees it only then', async () => {
    const s = await placedOrder();
    expect((await get(s.patient, `/lab-orders/${s.orderId}`)).status).toBe(404);

    const collected = await post(s.lab1, `/lab-orders/${s.orderId}/collect-sample`);
    expect(collected.status).toBe(200);
    expect(collected.body.data).toMatchObject({
      status: 'sample_collected',
      sample: { sampleId: `S${yy()}-000001`, type: 'blood', patientAgeYears: expect.any(Number) },
      label: {
        sampleId: `S${yy()}-000001`,
        orderNumber: expect.stringMatching(/^LAB-\d{4}-000001$/),
        patient: { mrn: expect.stringMatching(/^MRN-/), gender: 'male' },
        tests: [{ code: s.test.code, name: s.test.name }],
        collectedAt: expect.any(String),
      },
    });
    await post(s.lab1, `/lab-orders/${s.orderId}/start-processing`);

    // A partial save keeps the item pending and the order processing.
    const partial = await enter(s, [hb(14.2)]);
    expect(partial.status).toBe(200);
    expect(partial.body.data).toMatchObject({
      status: 'processing',
      items: [
        { status: 'pending', enteredBy: null, results: [{ parameterKey: 'hb', flag: 'normal' }] },
      ],
    });
    // The doctor does not see partial results.
    const early = await get(s.doctor, `/lab-orders/${s.orderId}`);
    expect(early.body.data.items[0]).toMatchObject({ resultsAvailable: false, results: [] });

    const complete = await enter(
      s,
      [hb(14.2), smear('Negative')],
      s.lab1,
      'Sample slightly lipaemic',
    );
    expect(complete.body.data).toMatchObject({
      status: 'result_entered',
      items: [{ status: 'result_entered', enteredBy: { id: s.lab1.user._id.toString() } }],
    });
    const unverified = await get(s.doctor, `/lab-orders/${s.orderId}`);
    expect(unverified.body.data.items[0]).toMatchObject({
      unverified: true,
      resultsAvailable: true,
    });

    const verified = await post(s.lab2, `/lab-orders/${s.orderId}/verify`);
    expect(verified.body.data).toMatchObject({
      status: 'verified',
      items: [{ status: 'verified', verifiedBy: { id: s.lab2.user._id.toString() } }],
    });
    expect((await get(s.patient, `/lab-orders/${s.orderId}`)).status).toBe(404);

    emails.sent.length = 0;
    const rel = await post(s.lab2, `/lab-orders/${s.orderId}/release`);
    expect(rel.body.data).toMatchObject({ status: 'released', releasedAt: expect.any(String) });
    const seen = await get(s.patient, `/lab-orders/${s.orderId}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.items[0].results).toEqual([
      expect.objectContaining({ parameterKey: 'hb', value: 14.2, flag: 'normal' }),
      expect.objectContaining({ parameterKey: 'smear', value: 'Negative', flag: 'na' }),
    ]);
    expect(JSON.stringify(seen.body)).not.toMatch(/lipaemic/);

    const stored = await LabOrder.findById(s.orderId).lean();
    expect(stored!.statusHistory.map((h) => h.status)).toEqual([
      'ordered',
      'sample_collected',
      'processing',
      'result_entered',
      'verified',
      'released',
    ]);
    // Patient and doctor are told – without clinical details.
    await vi.waitFor(() => expect(emails.sent.length).toBe(2));
    expect(emails.sent.map((m) => m.subject).sort()).toEqual([
      'Lab results ready',
      'New lab report',
    ]);
    expect(emails.sent.find((m) => m.subject === 'New lab report')!.text).toMatch(
      /A new lab report is available – please log in/,
    );
    expect(JSON.stringify(emails.sent)).not.toMatch(CLINICAL);
    // Events: ids only; the patient's account is told on release.
    expect(events).toContainEqual([
      [`user:${s.doctor.id}`, `user:${s.patient.user._id.toString()}`],
      'lab.order.changed',
      { orderId: s.orderId },
    ]);
    expect(JSON.stringify(events)).not.toMatch(CLINICAL);
    // Audits name the parameters, never the values.
    await flushAudit();
    const audit = JSON.stringify(await AuditLog.find({ action: /^lab_order\./ }).lean());
    expect(audit).toMatch(/lab_order\.results_enter/);
    expect(audit).not.toMatch(/\b14\.2\b|Negative|lipaemic/);
  });

  it('every invalid transition → 409 INVALID_STATUS_TRANSITION', async () => {
    const s = await placedOrder();
    const o = `/lab-orders/${s.orderId}`;
    expectError(await post(s.lab1, `${o}/start-processing`), 409, 'INVALID_STATUS_TRANSITION');
    expectError(await post(s.lab1, `${o}/recollect`), 409, 'INVALID_STATUS_TRANSITION');
    expectError(await post(s.lab1, `${o}/verify`), 409, 'INVALID_STATUS_TRANSITION');
    expectError(await post(s.lab1, `${o}/release`), 409, 'INVALID_STATUS_TRANSITION');
    expectError(await enter(s, [hb(14)]), 409, 'INVALID_STATUS_TRANSITION');
    await post(s.lab1, `${o}/collect-sample`);
    expectError(await post(s.lab1, `${o}/collect-sample`), 409, 'INVALID_STATUS_TRANSITION');
    expectError(await enter(s, [hb(14)]), 409, 'INVALID_STATUS_TRANSITION');
    expectError(
      await post(s.lab1, `${o}/send-back`, { reason: 'Nope' }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    await post(s.lab1, `${o}/start-processing`);
    expectError(
      await post(s.lab1, `${o}/reject-sample`, { reason: 'Late' }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    expectError(await post(s.lab2, `${o}/verify`), 409, 'INVALID_STATUS_TRANSITION');
    await enter(s, [hb(14), smear('Negative')]);
    expectError(await post(s.lab2, `${o}/release`), 409, 'INVALID_STATUS_TRANSITION');
    expectError(
      await post(s.lab2, `${o}/items/${s.itemId}/revise`, {
        results: [hb(13), smear('Negative')],
        reason: 'Too early here',
      }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
  });
});

describe('sample rejection and recollection', () => {
  it('reject (patient and reception told), recollect, collect a new sample', async () => {
    const s = await placedOrder();
    await loginAs('receptionist', { email: 'desk@clinic.dev' });
    await post(s.lab1, `/lab-orders/${s.orderId}/collect-sample`);
    emails.sent.length = 0;
    const noReason = await post(s.lab1, `/lab-orders/${s.orderId}/reject-sample`, {});
    expectError(noReason, 400, 'VALIDATION_ERROR');
    const rejected = await post(s.lab1, `/lab-orders/${s.orderId}/reject-sample`, {
      reason: 'Haemolysed sample',
    });
    expect(rejected.body.data).toMatchObject({
      status: 'sample_rejected',
      sample: { sampleId: `S${yy()}-000001`, rejection: { reason: 'Haemolysed sample' } },
    });
    await vi.waitFor(() => expect(emails.sent.length).toBe(2));
    expect(emails.sent.map((m) => m.to).sort()).toEqual([
      'desk@clinic.dev',
      'lab.patient@example.com',
    ]);
    expect(JSON.stringify(emails.sent)).not.toMatch(/Haemolysed|Lab test/);

    const again = await post(s.lab1, `/lab-orders/${s.orderId}/recollect`);
    expect(again.body.data).toMatchObject({ status: 'ordered', sample: null });
    const history = (await LabOrder.findById(s.orderId).lean())!.statusHistory.at(-1);
    expect(history).toMatchObject({
      status: 'ordered',
      note: `S${yy()}-000001 rejected: Haemolysed sample`,
    });
    const second = await post(s.lab1, `/lab-orders/${s.orderId}/collect-sample`);
    expect(second.body.data.sample.sampleId).toBe(`S${yy()}-000002`);
  });
});

describe('result entry', () => {
  it('validates each value against its parameter (400 with field paths)', async () => {
    const s = await placedOrder();
    await processing(s);
    const cases: [object[], string, string][] = [
      [[hb('14')], 'body.results.0.value', 'Enter a number'],
      [[hb(1e9)], 'body.results.0.value', 'Value out of range'],
      [[smear('Maybe')], 'body.results.0.value', 'Choose one of the options'],
      [
        [{ parameterKey: 'ldl', value: 1 }],
        'body.results.0.parameterKey',
        'Not a parameter of this test',
      ],
      [[hb(14), hb(15)], 'body.results.1.parameterKey', 'Given twice'],
    ];
    for (const [results, field, message] of cases) {
      const res = await enter(s, results);
      expect(expectError(res, 400, 'VALIDATION_ERROR').error.details).toEqual([{ field, message }]);
    }
    const tooLong = await put(s.lab1, `/lab-orders/${s.orderId}/items/${s.itemId}/results`, {
      results: [hb(14)],
      remarks: 'x'.repeat(1001),
    });
    expectError(tooLong, 400, 'VALIDATION_ERROR');
    expect((await LabOrder.findById(s.orderId).lean())!.items[0]!.results).toEqual([]);
  });

  it('the server computes flags and references (client flags ignored), by sex and age at collection', async () => {
    const s = await placedOrder();
    await processing(s);
    const res = await enter(s, [hb(12.5, { flag: 'normal' }), smear('Positive')]);
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].results).toEqual([
      expect.objectContaining({ value: 12.5, flag: 'low', referenceText: '13–17 g/dL' }), // adult male
      expect.objectContaining({ value: 'Positive', flag: 'abnormal', referenceText: 'Negative' }),
    ]);

    const child = await placedOrder({ dateOfBirth: '2020-01-01', gender: 'female' });
    await processing(child);
    const kid = await enter(child, [hb(12.5), smear('Negative')]);
    expect(kid.body.data.items[0].results[0]).toMatchObject({
      flag: 'normal',
      referenceText: '11–16 g/dL',
    });
  });

  it('only lab techs enter results; cancelled tests cannot get results', async () => {
    const s = await placedOrder();
    await processing(s);
    expect((await enter(s, [hb(14)], s.doctor)).status).toBe(403);
    await post(s.lab1, `/lab-orders/${s.orderId}/items/${s.itemId}/cancel`, {
      reason: 'No reagent',
    });
    // The only test is cancelled → the order is cancelled.
    expectError(await enter(s, [hb(14)]), 409, 'INVALID_STATUS_TRANSITION');
  });
});

describe('critical values (spec §8.7)', () => {
  it('alert the ordering doctor at once – email without clinical details + lab.critical – once per version', async () => {
    const s = await placedOrder();
    await processing(s);
    emails.sent.length = 0;
    const res = await enter(s, [hb(4.2)]); // partial, but critical
    expect(res.body.data).toMatchObject({
      hasCritical: true,
      items: [{ results: [{ flag: 'critical_low' }] }],
    });
    await vi.waitFor(() => expect(emails.sent).toHaveLength(1));
    expect(emails.sent[0]).toMatchObject({
      to: expect.stringContaining('@'),
      subject: 'Critical lab result',
    });
    expect(emails.sent[0]!.text).toMatch(
      /A critical lab result needs your attention – please log in/,
    );
    expect(JSON.stringify(emails.sent)).not.toMatch(CLINICAL);
    expect(events).toContainEqual([`user:${s.doctor.id}`, 'lab.critical', { orderId: s.orderId }]);

    // Saving again (still critical) does not alert twice.
    await enter(s, [hb(4.2), smear('Negative')]);
    await new Promise((r) => setTimeout(r, 50));
    expect(emails.sent).toHaveLength(1);
    expect(events.filter(([, e]) => e === 'lab.critical')).toHaveLength(1);

    // A corrected value clears hasCritical.
    await post(s.lab2, `/lab-orders/${s.orderId}/send-back`, { reason: 'Recheck the Hb' });
    const fixed = await enter(s, [hb(14), smear('Negative')]);
    expect(fixed.body.data.hasCritical).toBe(false);
  });

  it('with critical alerts off: flagged and marked, but no alert', async () => {
    await setSettings({ 'lab.criticalAlertEnabled': false });
    const s = await placedOrder();
    await processing(s);
    emails.sent.length = 0;
    const res = await enter(s, [hb(21)]);
    expect(res.body.data).toMatchObject({
      hasCritical: true,
      items: [{ results: [{ flag: 'critical_high' }] }],
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(emails.sent).toEqual([]);
    expect(events.filter(([, e]) => e === 'lab.critical')).toEqual([]);
  });
});

describe('verification (dual verification)', () => {
  it('the technician who entered results cannot verify them (422); another can', async () => {
    const s = await placedOrder();
    await processing(s);
    await enter(s, [hb(14), smear('Negative')]);
    expectError(
      await post(s.lab1, `/lab-orders/${s.orderId}/verify`),
      422,
      'SELF_VERIFICATION_NOT_ALLOWED',
    );
    expect((await post(s.lab2, `/lab-orders/${s.orderId}/verify`)).status).toBe(200);
    const [entry] = await auditEntries('lab_order.verify');
    expect(entry!.metadata).toMatchObject({ dualVerification: true, itemCount: 1 });
  });

  it('with dual verification off, the same technician may verify', async () => {
    await setSettings({ 'lab.requireDualVerification': false });
    const s = await placedOrder();
    await processing(s);
    await enter(s, [hb(14), smear('Negative')]);
    expect((await post(s.lab1, `/lab-orders/${s.orderId}/verify`)).status).toBe(200);
  });

  it('send back: result_entered → processing, values kept, re-saved to continue', async () => {
    const s = await placedOrder();
    await processing(s);
    await enter(s, [hb(14), smear('Negative')]);
    const back = await post(s.lab2, `/lab-orders/${s.orderId}/send-back`, {
      reason: 'Hb looks off – rerun',
    });
    expect(back.body.data).toMatchObject({
      status: 'processing',
      items: [{ status: 'pending', results: [{ value: 14 }, { value: 'Negative' }] }],
    });
    expect((await LabOrder.findById(s.orderId).lean())!.statusHistory.at(-1)!.note).toBe(
      'Sent back: Hb looks off – rerun',
    );
    // lab2 re-enters, so now lab1 may verify.
    await enter(s, [hb(13.6), smear('Negative')], s.lab2);
    expect((await post(s.lab1, `/lab-orders/${s.orderId}/verify`)).status).toBe(200);
  });
});

describe('revisions after release', () => {
  it('pending until another tech verifies; the patient keeps the released version until then', async () => {
    const s = await placedOrder();
    await released(s);
    const itemPath = `/lab-orders/${s.orderId}/items/${s.itemId}`;
    expectError(
      await post(s.lab1, `${itemPath}/revise`, {
        results: [hb(15.1)],
        reason: 'Transcription error',
      }),
      422,
      'RESULTS_INCOMPLETE',
    );
    expectError(
      await post(s.lab1, `${itemPath}/revise`, {
        results: [hb(15.1), smear('Negative')],
        reason: 'Short',
      }),
      400,
      'VALIDATION_ERROR',
    );
    const revise = await post(s.lab1, `${itemPath}/revise`, {
      results: [hb(5.1), smear('Negative')],
      reason: 'Transcription error',
    });
    expect(revise.status).toBe(200);
    expect(revise.body.data.items[0]).toMatchObject({
      resultVersion: 1,
      results: [{ value: 14.2 }, { value: 'Negative' }],
      pendingRevision: { results: [{ value: 5.1, flag: 'critical_low' }, { value: 'Negative' }] },
    });
    expect(
      (await get(s.patient, `/lab-orders/${s.orderId}`)).body.data.items[0].results[0].value,
    ).toBe(14.2);
    expect(
      (await get(s.doctor, `/lab-orders/${s.orderId}`)).body.data.items[0].revisionPending,
    ).toBe(true);
    // One pending revision at a time; the reviser cannot verify it.
    expectError(
      await post(s.lab2, `${itemPath}/revise`, {
        results: [hb(15), smear('Negative')],
        reason: 'Another fix here',
      }),
      409,
      'CONFLICT',
    );
    expectError(
      await post(s.lab1, `${itemPath}/verify-revision`),
      422,
      'SELF_VERIFICATION_NOT_ALLOWED',
    );

    await post(s.doctor, `/lab-orders/${s.orderId}/acknowledge`);
    emails.sent.length = 0;
    const applied = await post(s.lab2, `${itemPath}/verify-revision`);
    expect(applied.status).toBe(200);
    expect(applied.body.data.items[0]).toMatchObject({
      resultVersion: 2,
      results: [{ value: 5.1 }, { value: 'Negative' }],
      pendingRevision: null,
      enteredBy: { id: s.lab1.user._id.toString() },
      verifiedBy: { id: s.lab2.user._id.toString() },
      previousResults: [
        {
          version: 1,
          results: [{ value: 14.2 }, { value: 'Negative' }],
          reason: 'Transcription error',
        },
      ],
    });
    expect(applied.body.data.hasCritical).toBe(true);
    const patientView = await get(s.patient, `/lab-orders/${s.orderId}`);
    expect(patientView.body.data.items[0]).toMatchObject({
      resultVersion: 2,
      correctedAt: expect.any(String),
      results: [{ value: 5.1 }, { value: 'Negative' }],
    });
    // The doctor reviews again; patient + doctor told; the new critical value alerts.
    const doctorView = await get(s.doctor, `/lab-orders/${s.orderId}`);
    expect(doctorView.body.data.reviewedByDoctorAt).toBeNull();
    await vi.waitFor(() => expect(emails.sent.length).toBe(3));
    expect(emails.sent.map((m) => m.subject).sort()).toEqual([
      'Critical lab result',
      'Lab results corrected',
      'Updated lab report',
    ]);
    expect(JSON.stringify(emails.sent)).not.toMatch(CLINICAL);
    expect(await auditEntries('lab_order.revision_verify')).toHaveLength(1);
    const stored = await LabOrder.findById(s.orderId).lean();
    expect(stored!.statusHistory.map((h) => h.status).slice(-2)).toEqual(['released', 'released']);
    expectError(
      await post(s.lab2, `${itemPath}/verify-revision`),
      409,
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('with dual verification off a revision applies at once', async () => {
    const s = await placedOrder();
    await released(s);
    await setSettings({ 'lab.requireDualVerification': false });
    const res = await post(s.lab1, `/lab-orders/${s.orderId}/items/${s.itemId}/revise`, {
      results: [hb(14.8), smear('Negative')],
      reason: 'Recalibrated analyser',
    });
    expect(res.body.data.items[0]).toMatchObject({
      resultVersion: 2,
      pendingRevision: null,
      results: [{ value: 14.8 }, { value: 'Negative' }],
    });
    const [entry] = await auditEntries('lab_order.revise');
    expect(entry!.metadata).toMatchObject({ applied: true, resultVersion: 2 });
  });
});

describe('doctor acknowledgement', () => {
  it('marks results reviewed; they leave "results to review"; not before results; others 404', async () => {
    const s = await placedOrder();
    expectError(
      await post(s.doctor, `/lab-orders/${s.orderId}/acknowledge`),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    await released(s);
    const toReview = async () =>
      (await get(s.doctor, '/lab-orders?needsReview=true')).body.data.map(
        (o: { id: string }) => o.id,
      );
    expect(await toReview()).toEqual([s.orderId]);
    const stranger = await loginAsDoctor();
    expectError(await post(stranger, `/lab-orders/${s.orderId}/acknowledge`), 404, 'NOT_FOUND');
    const ack = await post(s.doctor, `/lab-orders/${s.orderId}/acknowledge`);
    expect(ack.body.data.reviewedByDoctorAt).toEqual(expect.any(String));
    expect(await toReview()).toEqual([]);
    expect(await auditEntries('lab_order.acknowledge')).toHaveLength(1);
  });
});

describe('lab TAT job (spec §8.11)', () => {
  it('marks open orders past their longest turnaround once, and tells the lab', async () => {
    const doctor = await loginAsDoctor();
    const { id: patient } = await createPatient();
    const test = await createLabTest({ turnaroundHours: 24 });
    const slow = await createLabTest({ turnaroundHours: 48 });
    const none = await createLabTest({ turnaroundHours: undefined });
    const snap = (t: typeof test, status = 'pending') => ({
      test: t._id,
      testSnapshot: {
        code: t.code,
        name: t.name,
        pricePaise: 1,
        ...(t.turnaroundHours ? { turnaroundHours: t.turnaroundHours } : {}),
      },
      status,
    });
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    const late = await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'processing',
      items: [snap(test)],
      orderedAt: hoursAgo(25),
    });
    const slowNotYet = await insertLabOrder({
      patient,
      doctor: doctor.id,
      items: [snap(test), snap(slow)],
      orderedAt: hoursAgo(25),
    });
    // A cancelled slow test no longer counts.
    const cancelledSlow = await insertLabOrder({
      patient,
      doctor: doctor.id,
      items: [snap(test), snap(slow, 'cancelled')],
      orderedAt: hoursAgo(25),
    });
    await insertLabOrder({
      patient,
      doctor: doctor.id,
      status: 'released',
      items: [snap(test, 'verified')],
      orderedAt: hoursAgo(100),
    });
    await insertLabOrder({
      patient,
      doctor: doctor.id,
      items: [snap(none)],
      orderedAt: hoursAgo(1000),
    });
    await insertLabOrder({ patient, doctor: doctor.id, status: 'draft', items: [snap(test)] });

    const first = await runLabTatJob();
    expect(first).toEqual({ marked: 2, skipped: 0, failed: 0 });
    const marked = await LabOrder.find({ tatBreachedAt: { $ne: null } })
      .select('_id')
      .lean();
    expect(marked.map((o) => o._id.toString()).sort()).toEqual(
      [late._id.toString(), cancelledSlow._id.toString()].sort(),
    );
    expect(events).toContainEqual([
      'lab',
      'lab.worklist.updated',
      { orderIds: expect.arrayContaining([late._id.toString()]) },
    ]);
    expect((await runLabTatJob()).marked).toBe(0);
    // 48 h later the slow order breaches too.
    expect((await runLabTatJob(new Date(Date.now() + 24 * 3_600_000))).marked).toBe(1);
    expect((await LabOrder.findById(slowNotYet._id).lean())!.tatBreachedAt).toBeInstanceOf(Date);
  });
});
