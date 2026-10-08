import { explanationOutputSchema } from '../src/ai/prompts/patientExplanation.v1.js';
import { mockPayloads, resetMock, setMockBehaviour } from '../src/ai/providers/mock.js';
import { AI_RULES } from '../src/config/constants.js';
import { config } from '../src/config/env.js';
import { EXPLANATION_DISCLAIMER, WHEN_TO_CONTACT_CLINIC } from '../src/data/safetyNet.js';
import { AiInteraction } from '../src/modules/aiInteractions/model.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
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
 * AI patient explanations (spec §4.12, §7.12, §7.13, §9.3) with the mock provider: the patient's
 * own issued prescriptions and signed follow-up plans, doctor previews, the cache (free), rate
 * limit and daily budget, guardrails → regenerate → template, the fixed disclaimer and contact
 * list, kill switches and consent, and feedback.
 */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    PatientExplanation.init(),
  ]);
  await useMiddayClinicZone();
  resetMock();
  emails = captureEmails();
});
afterEach(() => emails.restore());

/** A patient with a signed visit: an issued prescription and a follow-up plan. */
async function visit() {
  const patient = await loginAsPatient();
  const c = await readyToSign({
    patientId: patient.patientId,
    note: { followUp: { required: true, afterDays: 7, instructions: 'Bring the blood report' } },
    items: [
      rxItem({
        drugName: 'Amoxicillin',
        genericName: 'Amoxicillin',
        strength: '500 mg',
        form: 'capsule',
        dose: '1 capsule',
        instructions: 'Finish the full course',
      }),
      rxItem({
        drugName: 'Cetirizine',
        genericName: 'Cetirizine',
        strength: '10 mg',
        dose: '1 tablet',
        frequency: 'HS',
        timing: null,
        durationDays: 3,
      }),
    ],
  });
  await signNote(c.doctor, c.encounterId);
  return { ...c, patient, prescriptionId: c.prescriptionId! };
}

const explainRx = (who: LoggedIn, id: string, language = 'en') =>
  api().post(`/api/v1/prescriptions/${id}/explain`).set(who.auth).send({ language });
const explainPlan = (who: LoggedIn, id: string, language = 'en') =>
  api().post(`/api/v1/encounters/${id}/follow-up/explain`).set(who.auth).send({ language });

describe('POST /prescriptions/:id/explain', () => {
  it('explains the patient’s own issued prescription with the fixed disclaimer and contact list', async () => {
    const v = await visit();
    const res = await explainRx(v.patient, v.prescriptionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const x = res.body.data;
    expect(x).toMatchObject({
      sourceType: 'prescription',
      sourceId: v.prescriptionId,
      sourceVersion: 1,
      language: 'en',
      isFallback: false,
      fromCache: false,
      preview: false,
      feedback: null,
      disclaimer: EXPLANATION_DISCLAIMER.en,
    });
    expect(x.content.whenToContactClinic).toEqual(WHEN_TO_CONTACT_CLINIC.en);
    expect(x.content.medicines.map((m: { name: string }) => m.name)).toEqual([
      'Amoxicillin 500 mg',
      'Cetirizine 10 mg',
    ]);
    expect(x.guardrailFlags).toBeUndefined(); // doctors only
    expect(await AiInteraction.countDocuments({ feature: 'patient_explanation' })).toBe(1);
    const [entry] = await auditEntries('explanation.generate');
    expect(entry!.metadata).toMatchObject({ language: 'en', outcome: 'success', cached: true });
    expect(JSON.stringify(entry)).not.toMatch(/Amoxicillin|Finish the full course/);
  });

  it('explains in Hindi with the Hindi disclaimer and list', async () => {
    const v = await visit();
    const res = await explainRx(v.patient, v.prescriptionId, 'hi');
    expect(res.status).toBe(200);
    expect(res.body.data.disclaimer).toBe(EXPLANATION_DISCLAIMER.hi);
    expect(res.body.data.content.whenToContactClinic).toEqual(WHEN_TO_CONTACT_CLINIC.hi);
    expect(res.body.data.content.medicines[0].whenToTake).toBe(
      'दिन में तीन बार, खाना खाने के बाद।',
    );
  });

  it('serves the cache without an AI call, the rate limit or the daily budget', async () => {
    const v = await visit();
    await explainRx(v.patient, v.prescriptionId);
    const calls = mockPayloads().length;
    // The patient used up the hourly limit and the clinic its daily budget…
    const now = new Date();
    const row = (i: number, user?: unknown) => ({
      callId: `filler-${i}`,
      attempt: 1,
      feature: 'patient_explanation',
      user,
      provider: 'mock',
      promptVersion: 'patientExplanation.v1',
      inputHash: 'a'.repeat(64),
      status: 'success',
      createdAt: now,
    });
    await AiInteraction.collection.insertMany(
      Array.from({ length: AI_RULES.explanationsPerHour }, (_, i) => row(i, v.patient.user._id)),
    );
    const cached = await explainRx(v.patient, v.prescriptionId);
    expect(cached.status).toBe(200);
    expect(cached.body.data.fromCache).toBe(true);
    expect(mockPayloads()).toHaveLength(calls);
    // …a new language is not cached: the hourly limit applies.
    const limited = await explainRx(v.patient, v.prescriptionId, 'hi');
    expect(limited.status).toBe(429);
    expectErrorShape(limited.body, 'RATE_LIMITED');

    await AiInteraction.collection.deleteMany({ callId: /^filler-/ });
    await AiInteraction.collection.insertMany(
      Array.from({ length: config.ai.dailyCallLimit }, (_, i) => row(1000 + i)),
    );
    expect((await explainRx(v.patient, v.prescriptionId)).body.data.fromCache).toBe(true);
    // Over the daily budget the patient still gets help: the template, not cached.
    const overBudget = await explainRx(v.patient, v.prescriptionId, 'hi');
    expect(overBudget.status).toBe(200);
    expect(overBudget.body.data).toMatchObject({ isFallback: true, fromCache: false });
    expect(mockPayloads()).toHaveLength(calls);
    expect(await PatientExplanation.countDocuments({ language: 'hi', cached: true })).toBe(0);
  });

  it('blocks unsafe output twice → the template (cached), one request on the rate limit', async () => {
    const v = await visit();
    setMockBehaviour('unsafe');
    const res = await explainRx(v.patient, v.prescriptionId);
    expect(res.status).toBe(200);
    const x = res.body.data;
    expect(x.isFallback).toBe(true);
    expect(x.content.overview).not.toMatch(/You have/);
    expect(JSON.stringify(x.content)).not.toMatch(/Ibuprofen|7 days/);
    expect(x.content.medicines[0].howLong).toBe('For 5 days.');
    expect(x.disclaimer).toBe(EXPLANATION_DISCLAIMER.en);

    const stored = await PatientExplanation.findOne().lean();
    expect(stored).toMatchObject({ cached: true, outcome: 'blocked', isFallback: true });
    expect(stored!.guardrailFlags).toEqual(
      expect.arrayContaining([
        'medicine_not_prescribed',
        'number_mismatch',
        'forbidden_phrase',
        'regenerated',
        'fallback_template',
      ]),
    );
    const rows = await AiInteraction.find().sort({ attempt: 1 }).lean();
    expect(rows.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'blocked'],
      [2, 'blocked'],
    ]);
    expect(new Set(rows.map((r) => r.callId)).size).toBe(1);
    expect(rows[0]!.guardrailFlags).toContain('forbidden_phrase');
    const [blocked] = await auditEntries('explanation.blocked');
    expect(blocked!.metadata).toMatchObject({ outcome: 'blocked', isFallback: true });
    expect(JSON.stringify(blocked)).not.toMatch(/infection|Ibuprofen/);
  });

  it('uses the regenerated answer when it passes', async () => {
    const v = await visit();
    setMockBehaviour('unsafe', { times: 1 });
    const res = await explainRx(v.patient, v.prescriptionId, 'hi');
    expect(res.body.data.isFallback).toBe(false);
    const stored = await PatientExplanation.findOne().lean();
    expect(stored!.guardrailFlags).toContain('regenerated');
    expect(stored!.outcome).toBe('success');
  });

  it('falls back to the template when the AI is unavailable, without caching it', async () => {
    const v = await visit();
    setMockBehaviour('error');
    const res = await explainRx(v.patient, v.prescriptionId);
    expect(res.status).toBe(200);
    expect(res.body.data.isFallback).toBe(true);
    expect(await PatientExplanation.findOne().lean()).toMatchObject({
      cached: false,
      outcome: 'failed',
    });
    resetMock();
    const again = await explainRx(v.patient, v.prescriptionId);
    expect(again.body.data).toMatchObject({ isFallback: false, fromCache: false });
  });

  it('never takes the disclaimer or the contact list from the model', () => {
    const parsed = explanationOutputSchema.parse({
      overview: 'ok',
      medicines: [],
      disclaimer: 'MODEL DISCLAIMER',
      whenToContactClinic: ['MODEL ADVICE'],
    });
    expect(parsed).not.toHaveProperty('disclaimer');
    expect(parsed).not.toHaveProperty('whenToContactClinic');
  });

  it('a reissued prescription is a new version with its own cache', async () => {
    const v = await visit();
    await explainRx(v.patient, v.prescriptionId);
    const reissued = await api()
      .post(`/api/v1/prescriptions/${v.prescriptionId}/reissue`)
      .set(v.doctor.auth)
      .send({ reason: 'Change to a smaller dose' });
    expect(reissued.status).toBe(201);
    const issued = await api()
      .post(`/api/v1/prescriptions/${reissued.body.data.id}/issue`)
      .set(v.doctor.auth);
    expect(issued.status).toBe(200);
    const res = await explainRx(v.patient, reissued.body.data.id);
    expect(res.body.data).toMatchObject({ sourceVersion: 2, fromCache: false });
  });
});

describe('who may get an explanation', () => {
  it('403 AI_DISABLED when AI, the feature or the language is off, or the patient refused', async () => {
    const v = await visit();
    for (const off of [
      { 'ai.enabled': false },
      { 'ai.patientExplanationEnabled': false },
      { 'ai.explanationLanguages': ['en'] },
    ]) {
      await setSettings({
        'ai.enabled': true,
        'ai.patientExplanationEnabled': true,
        'ai.explanationLanguages': ['en', 'hi'],
        ...off,
      });
      const res = await explainRx(v.patient, v.prescriptionId, 'hi');
      expect(res.status, JSON.stringify(off)).toBe(403);
      expectErrorShape(res.body, 'AI_DISABLED');
    }
    await setSettings({ 'ai.explanationLanguages': ['en', 'hi'] });
    await Patient.updateOne(
      { _id: v.patient.patientId },
      { $set: { 'consent.aiExplanations': { given: false, at: new Date() } } },
    );
    for (const who of [v.patient, v.doctor]) {
      const res = await explainRx(who, v.prescriptionId);
      expect(res.status).toBe(403);
      expectErrorShape(res.body, 'AI_DISABLED');
    }
    expect(mockPayloads()).toHaveLength(0);
  });

  it('404 for another patient’s prescription; a draft cannot be explained', async () => {
    const v = await visit();
    const other = await loginAsPatient();
    const res = await explainRx(other, v.prescriptionId);
    expect(res.status).toBe(404);
    const draft = await readyToSign({ patientId: v.patient.patientId });
    expect((await explainRx(v.patient, draft.prescriptionId!)).status).toBe(404);
    const own = await explainRx(draft.doctor, draft.prescriptionId!);
    expect(own.status).toBe(422);
    expect(mockPayloads()).toHaveLength(0);
  });

  it('doctors preview (not cached for the patient); strangers get 404; reception 403', async () => {
    const v = await visit();
    const preview = await explainRx(v.doctor, v.prescriptionId);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ preview: true, fromCache: false });
    expect(preview.body.data.guardrailFlags).toEqual([]);
    expect(await PatientExplanation.countDocuments({ cached: true })).toBe(0);
    const forPatient = await explainRx(v.patient, v.prescriptionId);
    expect(forPatient.body.data.fromCache).toBe(false);
    // Once the patient's explanation is cached, a preview shows it (free).
    expect((await explainRx(v.doctor, v.prescriptionId)).body.data.fromCache).toBe(true);
    expect((await explainRx(await loginAsDoctor(), v.prescriptionId)).status).toBe(404);
  });
});

describe('POST /encounters/:id/follow-up/explain', () => {
  it('explains the follow-up plan of the patient’s own signed note', async () => {
    const v = await visit();
    const res = await explainPlan(v.patient, v.encounterId, 'en');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      sourceType: 'follow_up_plan',
      sourceVersion: 1,
      isFallback: false,
    });
    expect(res.body.data.content.followUp).toContain('Please come back after 7 days');
    expect(res.body.data.content.medicines).toEqual([]);
    expect(res.body.data.disclaimer).toBe(EXPLANATION_DISCLAIMER.en);
    // The follow-up input carries the plan only – never the clinical note.
    const sent = mockPayloads().at(-1)!.user;
    expect(sent).toContain('Bring the blood report');
    expect(sent).not.toMatch(/sore throat|pharyngitis|Amoxicillin/i);
  });

  it('422 without a plan or on a draft note; 404 for another patient', async () => {
    const v = await visit();
    const noPlan = await readyToSign({ patientId: v.patient.patientId });
    await signNote(noPlan.doctor, noPlan.encounterId);
    expect((await explainPlan(v.patient, noPlan.encounterId)).status).toBe(422);
    const draft = await readyToSign({ note: { followUp: { required: true, afterDays: 5 } } });
    expect((await explainPlan(draft.doctor, draft.encounterId)).status).toBe(422);
    expect((await explainPlan(await loginAsPatient(), v.encounterId)).status).toBe(404);
  });
});

describe('POST /prescriptions/:id/explain/feedback', () => {
  it('stores the patient’s rating on the cached explanation', async () => {
    const v = await visit();
    const rate = (body: object) =>
      api()
        .post(`/api/v1/prescriptions/${v.prescriptionId}/explain/feedback`)
        .set(v.patient.auth)
        .send(body);
    expect((await rate({ helpful: true })).status).toBe(404); // nothing to rate yet
    await explainRx(v.patient, v.prescriptionId);
    expect((await rate({ helpful: false, comment: 'x'.repeat(501) })).status).toBe(400);
    const res = await rate({ helpful: false, comment: 'Too long to read' });
    expect(res.status).toBe(200);
    expect(res.body.data.feedback).toMatchObject({ helpful: false, comment: 'Too long to read' });
    const [entry] = await auditEntries('explanation.feedback');
    expect(entry!.metadata).toMatchObject({ helpful: false, commentGiven: true });
    expect(JSON.stringify(entry)).not.toContain('Too long to read');
    const doctor = await api()
      .post(`/api/v1/prescriptions/${v.prescriptionId}/explain/feedback`)
      .set(v.doctor.auth)
      .send({ helpful: true });
    expect(doctor.status).toBe(403);
  });

  it('locks the explanation content', async () => {
    const v = await visit();
    await explainRx(v.patient, v.prescriptionId);
    await expect(
      PatientExplanation.updateOne({}, { $set: { 'content.overview': 'Tampered' } }),
    ).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
  });
});
