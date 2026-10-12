import { AI_RULES } from '../src/config/constants.js';
import { resetMock, setMockBehaviour } from '../src/ai/providers/mock.js';
import { AiInteraction } from '../src/modules/aiInteractions/model.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { auditEntries, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  loginAsDoctor,
  loginAsPatient,
  readyToSign,
  rxItem,
  setSettings,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * AI clinical summaries (spec §4.11, §7.11, §9.2) with the mock provider: generate (draft or
 * signed note), the server checks, edit, approve (signed + up to date, one approved), reject,
 * the kill switches, the rate limit, access, and the timeline.
 */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    ClinicalSummary.init(),
  ]);
  await useMiddayClinicZone();
  resetMock();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const base = (encounterId: string) => `/api/v1/encounters/${encounterId}/summary`;
const generate = (doctor: LoggedIn, encounterId: string) =>
  api()
    .post(`${base(encounterId)}/generate`)
    .set(doctor.auth);
const getSummary = (doctor: LoggedIn, encounterId: string) =>
  api().get(base(encounterId)).set(doctor.auth);
const approve = (doctor: LoggedIn, encounterId: string, id: string, body: object = {}) =>
  api()
    .post(`${base(encounterId)}/${id}/approve`)
    .set(doctor.auth)
    .send(body);

/** A signed note of a new patient (or `patientId`), with an issued prescription. */
async function signedVisit(
  options: { patientId?: string; doctor?: LoggedIn & { id: string } } = {},
) {
  const c = await readyToSign({
    ...options,
    note: { examination: 'Tonsils enlarged with exudate', plan: 'Warm saline gargles' },
    items: [rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin', strength: '500 mg' })],
  });
  await signNote(c.doctor, c.encounterId);
  return c;
}

describe('POST /encounters/:id/summary/generate', () => {
  it('creates a labelled draft from a draft note, with finalText and an ai_interactions row', async () => {
    const c = await readyToSign();
    const res = await generate(c.doctor, c.encounterId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.message).toBe('Draft summary generated – review before approving');
    const s = res.body.data;
    expect(s).toMatchObject({
      status: 'draft',
      label: 'AI draft – review before use',
      encounterId: c.encounterId,
      isOutdated: false,
      editedByDoctor: false,
      shareWithPatient: false,
      serverFlags: [],
      promptVersion: 'clinicalSummary.v1',
      isFallbackModel: false,
      revision: 0,
    });
    expect(s.aiDraft.assessment).toBe('Documented provisional diagnosis: Acute pharyngitis.');
    expect(s.aiDraft.medications).toEqual([expect.stringContaining('Paracetamol')]);
    expect(s.finalText).toContain(
      'Assessment: Documented provisional diagnosis: Acute pharyngitis.',
    );

    const rows = await AiInteraction.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'clinical_summary',
      status: 'success',
      attempt: 1,
      source: { type: 'encounter', version: 1 },
    });
    expect(rows[0]!.source!.id!.toString()).toBe(c.encounterId);
    const [audit] = await auditEntries('summary.generate');
    expect(audit!.metadata).toMatchObject({ flags: [], attempts: 1, isFallbackModel: false });
  });

  it('removes and flags an invented diagnosis and an unprescribed medicine', async () => {
    const c = await signedVisit();
    setMockBehaviour('unsafe');
    const res = await generate(c.doctor, c.encounterId);
    expect(res.status).toBe(201);
    const s = res.body.data;
    expect(s.serverFlags).toEqual([
      'unverified_diagnosis_removed',
      'unverified_medication_removed',
    ]);
    expect(s.aiDraft.assessment).not.toMatch(/pneumonia/i);
    expect(s.aiDraft.assessment).toMatch(/Acute pharyngitis/);
    expect(s.aiDraft.medications.join(' ')).not.toMatch(/Azithromycin/);
    expect(s.aiDraft.medications.join(' ')).toMatch(/Amoxicillin/);
    expect(s.finalText).not.toMatch(/pneumonia|Azithromycin/i);
  });

  it('records the fallback model and the retry as flags', async () => {
    const c = await signedVisit();
    setMockBehaviour('invalid', { times: 3 }); // main model twice, then the first fallback once
    const res = await generate(c.doctor, c.encounterId);
    expect(res.status).toBe(201);
    expect(res.body.data.isFallbackModel).toBe(true);
    expect(res.body.data.serverFlags).toEqual(['output_retried', 'fallback_model']);
    expect(await AiInteraction.countDocuments()).toBe(4);
  });

  it('a newer draft supersedes the previous draft', async () => {
    const c = await signedVisit();
    const first = await generate(c.doctor, c.encounterId);
    const second = await generate(c.doctor, c.encounterId);
    expect(second.status).toBe(201);
    const statuses = await ClinicalSummary.find().sort({ createdAt: 1 }).lean();
    expect(statuses.map((s) => s.status)).toEqual(['superseded', 'draft']);
    expect(statuses[0]!._id.toString()).toBe(first.body.data.id);
  });

  it('503 when the AI fails: the attempt is kept as failed and the note is untouched', async () => {
    const c = await signedVisit();
    setMockBehaviour('invalid');
    const res = await generate(c.doctor, c.encounterId);
    expect(res.status).toBe(503);
    expectErrorShape(res.body, 'AI_OUTPUT_INVALID');
    setMockBehaviour('rate_limited');
    const busy = await generate(c.doctor, c.encounterId);
    expectErrorShape(busy.body, 'AI_UNAVAILABLE');
    expect(busy.body.message).toBe('The AI is busy, try again in a minute');
    expect(busy.body.error.details).toEqual({ retryAfter: 20 });

    const rows = await ClinicalSummary.find().lean();
    expect(rows.map((r) => [r.status, r.errorCode])).toEqual([
      ['failed', 'AI_OUTPUT_INVALID'],
      ['failed', 'AI_UNAVAILABLE'],
    ]);
    const shown = await getSummary(c.doctor, c.encounterId);
    expect(shown.body.data).toMatchObject({
      draft: null,
      approved: null,
      lastAttempt: { status: 'failed', errorCode: 'AI_UNAVAILABLE' },
    });
    const [failed] = await auditEntries('summary.generate');
    expect(failed!.outcome).toBe('failure');
  });

  it('is limited to 10 per minute per doctor (first attempts only)', async () => {
    const c = await signedVisit();
    const now = new Date();
    await AiInteraction.collection.insertMany([
      ...Array.from({ length: AI_RULES.summaryGenerationsPerMinute - 1 }, (_, i) => ({
        callId: `old-${i}`,
        attempt: 1,
        feature: 'clinical_summary',
        user: c.doctor.user._id,
        provider: 'mock',
        promptVersion: 'clinicalSummary.v1',
        inputHash: 'a'.repeat(64),
        status: 'success',
        createdAt: now,
      })),
      // Retries and fallbacks of those calls do not count toward the doctor's limit.
      ...Array.from({ length: 5 }, (_, i) => ({
        callId: `old-${i}`,
        attempt: 2,
        feature: 'clinical_summary',
        user: c.doctor.user._id,
        provider: 'mock',
        promptVersion: 'clinicalSummary.v1',
        inputHash: 'a'.repeat(64),
        status: 'failed',
        createdAt: now,
      })),
    ]);
    expect((await generate(c.doctor, c.encounterId)).status).toBe(201);
    const limited = await generate(c.doctor, c.encounterId);
    expect(limited.status).toBe(429);
    expectErrorShape(limited.body, 'RATE_LIMITED');
  });

  it('403 AI_DISABLED when AI or the feature is off – reading stored summaries still works', async () => {
    const c = await signedVisit();
    const draft = await generate(c.doctor, c.encounterId);
    const id = draft.body.data.id as string;
    for (const off of [{ 'ai.enabled': false }, { 'ai.clinicalSummaryEnabled': false }]) {
      await setSettings({ 'ai.enabled': true, 'ai.clinicalSummaryEnabled': true, ...off });
      const calls = [
        generate(c.doctor, c.encounterId),
        api()
          .patch(`${base(c.encounterId)}/${id}`)
          .set(c.doctor.auth)
          .send({ expectedVersion: 0, finalText: 'Edited' }),
        approve(c.doctor, c.encounterId, id),
        api()
          .post(`${base(c.encounterId)}/${id}/reject`)
          .set(c.doctor.auth)
          .send({ reason: 'Not useful for this visit' }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
        expectErrorShape(res.body, 'AI_DISABLED');
      }
      const read = await getSummary(c.doctor, c.encounterId);
      expect(read.status).toBe(200);
      expect(read.body.data.draft.id).toBe(id);
      expect(read.body.data.aiEnabled).toBe(false);
    }
    // The note itself is unaffected.
    expect((await api().get(`/api/v1/encounters/${c.encounterId}`).set(c.doctor.auth)).status).toBe(
      200,
    );
  });
});

describe('edit, approve, reject', () => {
  it('the doctor edits the draft text with the revision (409 on a stale one)', async () => {
    const c = await signedVisit();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    const res = await api()
      .patch(`${base(c.encounterId)}/${id}`)
      .set(c.doctor.auth)
      .send({ expectedVersion: 0, finalText: 'Doctor-edited summary.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      finalText: 'Doctor-edited summary.',
      editedByDoctor: true,
      revision: 1,
    });
    const stale = await api()
      .patch(`${base(c.encounterId)}/${id}`)
      .set(c.doctor.auth)
      .send({ expectedVersion: 0, finalText: 'Again' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({ currentRevision: 1 });
    const tooLong = await api()
      .patch(`${base(c.encounterId)}/${id}`)
      .set(c.doctor.auth)
      .send({ expectedVersion: 1, finalText: 'x'.repeat(AI_RULES.finalTextMax + 1) });
    expect(tooLong.status).toBe(400);
    const [entry] = await auditEntries('summary.update');
    expect(entry!.changes).toMatchObject({ fields: ['finalText'] });
    expect(JSON.stringify(entry)).not.toContain('Doctor-edited');
  });

  it('422 NOTE_NOT_SIGNED while the note is a draft; after signing the same draft is approved', async () => {
    const c = await readyToSign();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    const early = await approve(c.doctor, c.encounterId, id);
    expect(early.status).toBe(422);
    expectErrorShape(early.body, 'NOTE_NOT_SIGNED');

    await signNote(c.doctor, c.encounterId);
    const res = await approve(c.doctor, c.encounterId, id, { shareWithPatient: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'approved',
      shareWithPatient: true,
      label: 'AI-assisted · reviewed',
      reviewedBy: { id: c.doctor.id },
    });
    const [entry] = await auditEntries('summary.approve');
    expect(entry!.metadata).toMatchObject({ shareWithPatient: true, supersededSummaryId: null });
  });

  it('409 SUMMARY_OUTDATED when the note changed after generating (amendment)', async () => {
    const c = await signedVisit();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    const amended = await api()
      .post(`/api/v1/encounters/${c.encounterId}/amendments`)
      .set(c.doctor.auth)
      .send({ reason: 'Corrected the plan after review', changes: { plan: 'Steam inhalation' } });
    expect(amended.status).toBe(201);
    const shown = await getSummary(c.doctor, c.encounterId);
    expect(shown.body.data.isOutdated).toBe(true);
    expect(shown.body.data.draft.isOutdated).toBe(true);
    const res = await approve(c.doctor, c.encounterId, id);
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'SUMMARY_OUTDATED');
  });

  it('409 SUMMARY_OUTDATED when a draft note changed after generating, then signed', async () => {
    const c = await readyToSign();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    const note = await api().get(`/api/v1/encounters/${c.encounterId}`).set(c.doctor.auth);
    await api()
      .patch(`/api/v1/encounters/${c.encounterId}`)
      .set(c.doctor.auth)
      .send({ expectedVersion: note.body.data.revision, plan: 'Changed after the summary' });
    await signNote(c.doctor, c.encounterId);
    const res = await approve(c.doctor, c.encounterId, id);
    expectErrorShape(res.body, 'SUMMARY_OUTDATED');
  });

  it('a second approval supersedes the first: one approved summary per note', async () => {
    const c = await signedVisit();
    const first = (await generate(c.doctor, c.encounterId)).body.data.id as string;
    expect((await approve(c.doctor, c.encounterId, first)).status).toBe(200);
    const second = (await generate(c.doctor, c.encounterId)).body.data.id as string;
    // The approved summary stays until the new draft is approved.
    const meanwhile = await getSummary(c.doctor, c.encounterId);
    expect(meanwhile.body.data.approved.id).toBe(first);
    expect(meanwhile.body.data.draft.id).toBe(second);

    const res = await approve(c.doctor, c.encounterId, second);
    expect(res.status).toBe(200);
    const all = await ClinicalSummary.find().lean();
    expect(Object.fromEntries(all.map((s) => [s._id.toString(), s.status]))).toEqual({
      [first]: 'superseded',
      [second]: 'approved',
    });
    const [, entry] = await auditEntries('summary.approve');
    expect(entry!.metadata).toMatchObject({ supersededSummaryId: first });
    // An approved or superseded summary cannot be approved (again).
    const again = await approve(c.doctor, c.encounterId, first);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');
  });

  it('rejects a draft with a reason of at least 10 characters', async () => {
    const c = await signedVisit();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    const reject = (reason: string) =>
      api()
        .post(`${base(c.encounterId)}/${id}/reject`)
        .set(c.doctor.auth)
        .send({ reason });
    expect((await reject('Too short')).status).toBe(400);
    const res = await reject('Misses the examination findings');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Misses the examination findings',
    });
    expectErrorShape(
      (await reject('Misses the examination findings')).body,
      'INVALID_STATUS_TRANSITION',
    );
    const [entry] = await auditEntries('summary.reject');
    expect(JSON.stringify(entry)).not.toContain('examination findings');
  });

  it('locks reviewed summaries in the model', async () => {
    const c = await signedVisit();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    await approve(c.doctor, c.encounterId, id);
    await expect(
      ClinicalSummary.updateOne({ _id: id }, { $set: { finalText: 'Tampered' } }),
    ).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    await expect(ClinicalSummary.deleteOne({ _id: id })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
    });
  });
});

describe('access and the timeline', () => {
  it('other doctors: 404 without a care relationship; approved summary only with one', async () => {
    const c = await signedVisit();
    const { id } = (await generate(c.doctor, c.encounterId)).body.data;
    const stranger = await loginAsDoctor();
    for (const res of [
      await generate(stranger, c.encounterId),
      await getSummary(stranger, c.encounterId),
      await approve(stranger, c.encounterId, id),
    ]) {
      expect(res.status).toBe(404);
    }
    // A colleague who also sees the patient reads the approved summary, never the draft.
    const colleague = await loginAsDoctor();
    await readyToSign({ doctor: colleague, patientId: c.patientId });
    const before = await getSummary(colleague, c.encounterId);
    expect(before.body.data).toMatchObject({ draft: null, approved: null, aiEnabled: false });
    await approve(c.doctor, c.encounterId, id);
    const after = await getSummary(colleague, c.encounterId);
    expect(after.body.data.approved.id).toBe(id);
    expect((await approve(colleague, c.encounterId, id)).status).toBe(404);
  });

  it('approved summaries are timeline items; patients see only shared ones', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor({});
    const shared = await signedVisit({ patientId: patient.patientId, doctor });
    const privateVisit = await signedVisit({ patientId: patient.patientId, doctor });
    const draftOnly = await signedVisit({ patientId: patient.patientId, doctor });
    const a = (await generate(doctor, shared.encounterId)).body.data.id as string;
    const b = (await generate(doctor, privateVisit.encounterId)).body.data.id as string;
    await generate(doctor, draftOnly.encounterId);
    await approve(doctor, shared.encounterId, a, { shareWithPatient: true });
    await approve(doctor, privateVisit.encounterId, b);

    const items = async (res: { body: { data: { type: string; id: string }[] } }) =>
      res.body.data.filter((i) => i.type === 'clinical_summary').map((i) => i.id);
    const mine = await api().get('/api/v1/patients/me/timeline').set(patient.auth);
    expect(mine.status).toBe(200);
    expect(await items(mine)).toEqual([a]);
    const item = mine.body.data.find((i: { id: string }) => i.id === a);
    expect(item).toMatchObject({
      title: 'Visit summary (AI-assisted)',
      subtitle: expect.stringMatching(/^Reviewed by Dr /),
      link: `/patient/visits/${shared.encounterId}`,
    });
    const doctors = await api()
      .get(`/api/v1/patients/${patient.patientId}/timeline?types=clinical_summary`)
      .set(doctor.auth);
    expect(doctors.status).toBe(200);
    expect((await items(doctors)).sort()).toEqual([a, b].sort());
    const flagsOf = (id: string) =>
      doctors.body.data.find((i: { id: string }) => i.id === id).flags as string[];
    expect(flagsOf(a)).toEqual(['ai_assisted', 'shared_with_patient']);
    expect(flagsOf(b)).toEqual(['ai_assisted']);
    expect(item.flags).toEqual(['ai_assisted']);
    expect(JSON.stringify(doctors.body)).not.toMatch(/pharyngitis|Amoxicillin/i);
  });

  it('the patient’s visit view carries the shared summary text only', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor({});
    const shared = await signedVisit({ patientId: patient.patientId, doctor });
    const privateVisit = await signedVisit({ patientId: patient.patientId, doctor });
    const a = (await generate(doctor, shared.encounterId)).body.data.id as string;
    const b = (await generate(doctor, privateVisit.encounterId)).body.data.id as string;
    await approve(doctor, shared.encounterId, a, { shareWithPatient: true });
    await approve(doctor, privateVisit.encounterId, b);
    const visit = (id: string) => api().get(`/api/v1/encounters/${id}`).set(patient.auth);

    const res = await visit(shared.encounterId);
    expect(res.status).toBe(200);
    expect(res.body.data.aiSummary).toEqual({
      text: expect.any(String),
      reviewedBy: expect.stringMatching(/^Dr /),
      reviewedAt: expect.any(String),
    });
    expect(Object.keys(res.body.data.aiSummary).sort()).toEqual([
      'reviewedAt',
      'reviewedBy',
      'text',
    ]);
    expect((await visit(privateVisit.encounterId)).body.data.aiSummary).toBeNull();
  });
});
