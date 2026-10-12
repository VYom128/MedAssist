import { parseEvalArgs, runEval } from '../src/ai/eval.js';
import { resetMock, setMockBehaviour } from '../src/ai/providers/mock.js';
import { config } from '../src/config/env.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { loginAs, resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import { loginAsPatient, readyToSign, signNote, useMiddayClinicZone } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * The admin AI monitor (GET /ai/interactions, /ai/interactions/summary, /ai/config) and the
 * eval script's refusals. Nothing returned carries prompts, outputs, patient data or the key.
 */

const CONTENT = /Fever and sore throat|pharyngitis|Paracetamol|Documented|आपको|tablet/i;

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init()]);
  await useMiddayClinicZone();
  resetMock();
  emails = captureEmails();
});
afterEach(() => emails.restore());

/** Some AI traffic: a summary (retried once), a blocked-then-template explanation, a failure. */
async function traffic() {
  const patient = await loginAsPatient();
  const c = await readyToSign({ patientId: patient.patientId });
  await signNote(c.doctor, c.encounterId);
  setMockBehaviour('invalid', { times: 1 });
  expect(
    (await api().post(`/api/v1/encounters/${c.encounterId}/summary/generate`).set(c.doctor.auth))
      .status,
  ).toBe(201);
  setMockBehaviour('unsafe');
  const x = await api()
    .post(`/api/v1/prescriptions/${c.prescriptionId}/explain`)
    .set(patient.auth)
    .send({ language: 'en' });
  expect(x.body.data.isFallback).toBe(true);
  const rated = await api()
    .post(`/api/v1/prescriptions/${c.prescriptionId}/explain/feedback`)
    .set(patient.auth)
    .send({ helpful: true });
  expect(rated.status).toBe(200);
  setMockBehaviour('rate_limited');
  await api().post(`/api/v1/encounters/${c.encounterId}/summary/generate`).set(c.doctor.auth);
  resetMock();
  return c;
}

describe('GET /ai/interactions', () => {
  it('lists attempts newest first with filters, without content or ids of people', async () => {
    await traffic();
    const admin = await loginAs('admin');
    const res = await api().get('/api/v1/ai/interactions?limit=50').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 50 });
    const rows = res.body.data as Record<string, unknown>[];
    expect(rows.length).toBe(res.body.meta.total);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      callId: expect.any(String),
      attempt: expect.any(Number),
      feature: expect.any(String),
      status: expect.any(String),
      provider: 'mock',
      model: expect.any(String),
      isFallbackModel: expect.any(Boolean),
      promptVersion: expect.any(String),
      errorReason: expect.toBeOneOf([null, expect.any(String)]),
      guardrailFlags: expect.any(Array),
      usage: { inputTokens: expect.any(Number), outputTokens: expect.any(Number) },
      latencyMs: expect.any(Number),
      requestedByRole: expect.any(String),
      sourceType: expect.any(String),
      createdAt: expect.any(String),
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(CONTENT);
    expect(body).not.toMatch(/"(patient|user|inputHash)":/);

    const blocked = await api().get('/api/v1/ai/interactions?status=blocked').set(admin.auth);
    expect(blocked.body.data.map((r: { status: string }) => r.status)).toEqual([
      'blocked',
      'blocked',
    ]);
    const summaries = await api()
      .get('/api/v1/ai/interactions?feature=clinical_summary')
      .set(admin.auth);
    expect(
      summaries.body.data.every((r: { feature: string }) => r.feature === 'clinical_summary'),
    ).toBe(true);
    const byModel = await api()
      .get(`/api/v1/ai/interactions?model=${encodeURIComponent(config.ai.model)}`)
      .set(admin.auth);
    expect(byModel.body.data.every((r: { model: string }) => r.model === config.ai.model)).toBe(
      true,
    );
    const bad = await api()
      .get('/api/v1/ai/interactions?from=2026-10-09&to=2026-10-01')
      .set(admin.auth);
    expect(bad.status).toBe(400);
  });
});

describe('GET /ai/interactions/summary', () => {
  it('reports rates, blocks, tokens, latency, feedback and calls per model', async () => {
    await traffic();
    const admin = await loginAs('admin');
    const res = await api().get('/api/v1/ai/interactions/summary').set(admin.auth);
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s).toMatchObject({
      range: { from: expect.any(String), to: expect.any(String) },
      guardrailBlocks: 2,
      templateFallbackRate: 1,
      explanations: 1,
      feedback: { rated: 1, helpful: 1, helpfulPercent: 100 },
    });
    expect(s.attempts).toBeGreaterThanOrEqual(6);
    expect(s.calls).toBe(3);
    expect(s.failureRate).toBeGreaterThan(0);
    expect(s.fallbackModelRate).toBe(0);
    expect(s.tokens.input).toBeGreaterThan(0);
    expect(s.latency).toEqual({ averageMs: expect.any(Number), p95Ms: expect.any(Number) });
    expect(s.guardrailFlags).toEqual(
      expect.arrayContaining([{ flag: 'forbidden_phrase', count: 2 }]),
    );
    expect(s.perModel.map((m: { model: string }) => m.model)).toContain(config.ai.model);
    expect(s.perDay).toHaveLength(30);
    expect(s.perDay.at(-1).date).toBe(s.range.to);
    expect(s.perDay.reduce((n: number, d: { attempts: number }) => n + d.attempts, 0)).toBe(
      s.attempts,
    );
    expect(JSON.stringify(res.body)).not.toMatch(CONTENT);

    const empty = await api()
      .get('/api/v1/ai/interactions/summary?from=2020-01-01&to=2020-01-31')
      .set(admin.auth);
    expect(empty.body.data).toMatchObject({ attempts: 0, calls: 0, failureRate: 0 });
    expect(empty.body.data.perDay).toHaveLength(31);
  });
});

describe('GET /ai/config', () => {
  it('shows the provider, models and today’s calls vs the limit – never the key', async () => {
    await traffic();
    const admin = await loginAs('admin');
    const res = await api().get('/api/v1/ai/config').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      provider: 'mock',
      baseUrlHost: null,
      model: config.ai.model,
      fallbackModels: [...new Set(config.ai.fallbackModels)].filter((m) => m !== config.ai.model),
      timeoutMs: config.ai.timeoutMs,
      temperature: config.ai.temperature,
      maxTokens: config.ai.maxTokens,
      today: { calls: expect.any(Number), limit: config.ai.dailyCallLimit },
      enabled: {
        ai: true,
        clinicalSummary: true,
        patientExplanation: true,
        explanationLanguages: ['en', 'hi'],
      },
    });
    expect(res.body.data.today.calls).toBeGreaterThanOrEqual(6);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/apiKey|api_key|Bearer/i);
    if (config.ai.apiKey) expect(body).not.toContain(config.ai.apiKey);
  });

  it('is admin only', async () => {
    for (const role of ['doctor', 'receptionist', 'labtech', 'patient'] as const) {
      const who = await loginAs(role);
      for (const path of ['/ai/config', '/ai/interactions', '/ai/interactions/summary']) {
        const res = await api().get(`/api/v1${path}`).set(who.auth);
        expect(res.status, `${role} ${path}`).toBe(403);
        expectErrorShape(res.body, 'FORBIDDEN');
      }
    }
  });
});

describe('npm run ai:eval', () => {
  it('refuses with the mock provider, and without --confirm', async () => {
    expect(parseEvalArgs(['--confirm'], true).refusal).toMatch(/needs a real provider/);
    expect(parseEvalArgs([], false).refusal).toMatch(/Re-run with --confirm/);
    expect(parseEvalArgs(['--confirm', '--limit', '3'], false)).toEqual({
      refusal: null,
      options: { limit: 3 },
    });
    expect(parseEvalArgs(['--confirm', '--limit', 'lots'], false).options.limit).toBe(5);
    // Tests always run with the mock provider: the script refuses before touching anything.
    const lines: string[] = [];
    expect(await runEval(['--confirm'], (l) => lines.push(l))).toBe(1);
    expect(lines.join('\n')).toMatch(/Refusing to run/);
  });
});
