import { resetMock, setMockBehaviour } from '../src/ai/providers/mock.js';
import { config } from '../src/config/env.js';
import { EXPLANATION_DISCLAIMER } from '../src/data/safetyNet.js';
import { AiInteraction } from '../src/modules/aiInteractions/model.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { loginAs, resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  loginAsPatient,
  readyToSign,
  rxItem,
  setSettings,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * The app keeps working without AI (Phase 9 close-out): with every switch off, with the provider
 * failing (5xx, 429) and with the daily budget used up, a doctor still writes, signs and reads
 * the visit, a patient still reads their prescription and visit (explanations fall back to the
 * template, or are refused when switched off) and the admin monitor still loads.
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

async function useUpDailyBudget() {
  await AiInteraction.create(
    Array.from({ length: config.ai.dailyCallLimit }, (_, i) => ({
      callId: `budget-${i}`,
      attempt: 1,
      feature: 'clinical_summary',
      provider: 'mock',
      promptVersion: 'test.v1',
      inputHash: 'a'.repeat(64),
      status: 'success',
    })),
  );
}

const SCENARIOS = [
  {
    name: 'every AI switch off',
    setup: () =>
      setSettings({
        'ai.enabled': false,
        'ai.clinicalSummaryEnabled': false,
        'ai.patientExplanationEnabled': false,
      }),
    summary: { status: 403, code: 'AI_DISABLED' },
    explanation: 'refused' as const,
  },
  {
    name: 'the provider failing (5xx)',
    setup: () => setMockBehaviour('error'),
    summary: { status: 503, code: 'AI_UNAVAILABLE' },
    explanation: 'template' as const,
  },
  {
    name: 'the provider rate limited (429)',
    setup: () => setMockBehaviour('rate_limited'),
    summary: { status: 503, code: 'AI_UNAVAILABLE', message: /busy/ },
    explanation: 'template' as const,
  },
  {
    name: 'the daily limit reached',
    setup: useUpDailyBudget,
    summary: { status: 503, code: 'AI_UNAVAILABLE', message: /Daily AI limit/ },
    explanation: 'template' as const,
  },
];

describe.each(SCENARIOS)('with $name', (scenario) => {
  it('doctors, patients and admins can still do their work', async () => {
    const patient = await loginAsPatient();
    const c = await readyToSign({
      patientId: patient.patientId,
      note: { followUp: { required: true, afterDays: 7, instructions: 'Bring the blood report' } },
      items: [rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin', strength: '500 mg' })],
    });
    await scenario.setup();

    // Doctor: the summary is refused with a clear code, the summary state still reads.
    const gen = await api()
      .post(`/api/v1/encounters/${c.encounterId}/summary/generate`)
      .set(c.doctor.auth);
    expect(gen.status).toBe(scenario.summary.status);
    expectErrorShape(gen.body, scenario.summary.code);
    if (scenario.summary.message) expect(gen.body.message).toMatch(scenario.summary.message);
    const state = await api().get(`/api/v1/encounters/${c.encounterId}/summary`).set(c.doctor.auth);
    expect(state.status).toBe(200);
    expect(state.body.data.approved).toBeNull();

    // …and signs and reads the visit as usual.
    await signNote(c.doctor, c.encounterId);
    for (const path of [`/encounters/${c.encounterId}`, `/prescriptions/${c.prescriptionId}`]) {
      expect((await api().get(`/api/v1${path}`).set(c.doctor.auth)).status).toBe(200);
    }

    // Patient: the prescription, visit and timeline load; explanations are refused or templated.
    for (const path of [
      `/prescriptions/${c.prescriptionId}`,
      `/encounters/${c.encounterId}`,
      '/patients/me/visits',
      '/patients/me/timeline',
    ]) {
      expect((await api().get(`/api/v1${path}`).set(patient.auth)).status).toBe(200);
    }
    for (const path of [
      `/prescriptions/${c.prescriptionId}/explain`,
      `/encounters/${c.encounterId}/follow-up/explain`,
    ]) {
      const res = await api().post(`/api/v1${path}`).set(patient.auth).send({ language: 'en' });
      if (scenario.explanation === 'refused') {
        expect(res.status).toBe(403);
        expectErrorShape(res.body, 'AI_DISABLED');
      } else {
        expect(res.status).toBe(200);
        expect(res.body.data.isFallback).toBe(true);
        expect(res.body.data.disclaimer).toBe(EXPLANATION_DISCLAIMER.en);
        expect(res.body.data.content.whenToContactClinic.length).toBeGreaterThan(0);
      }
    }
    // A template written while the AI was down is not cached as the patient's explanation.
    expect(await PatientExplanation.countDocuments({ isFallback: false })).toBe(0);

    // The clinic's public settings tell the client what to hide.
    const pub = await api().get('/api/v1/settings/public');
    const off = scenario.explanation === 'refused';
    expect(pub.body.data.ai).toMatchObject({
      enabled: !off,
      clinicalSummaryEnabled: !off,
      patientExplanationEnabled: !off,
    });

    // Admin: the monitor still loads.
    const admin = await loginAs('admin');
    for (const path of ['/ai/interactions', '/ai/interactions/summary', '/ai/config']) {
      expect((await api().get(`/api/v1${path}`).set(admin.auth)).status).toBe(200);
    }
  });
});
