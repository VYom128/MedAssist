import { z } from 'zod';
import { AiCallError, generateJson } from '../src/ai/ai.service.js';
import { callsToday } from '../src/ai/guards.js';
import { modelChain } from '../src/ai/providers/index.js';
import {
  MOCK_RETRY_AFTER_SECONDS,
  mockPayloads,
  registerMockBuilder,
  resetMock,
  setMockBehaviour,
  setMockRules,
} from '../src/ai/providers/mock.js';
import { config } from '../src/config/env.js';
import { AiInteraction } from '../src/modules/aiInteractions/model.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { logger } from '../src/utils/logger.js';
import { resetDb } from './helpers/auth.js';

/**
 * ai.service with the mock provider (spec §9.1): one retry of invalid output per model, the
 * model fallback chain, one ai_interactions row per attempt, the daily budget, and no prompt or
 * output text in logs, ai_interactions or audit entries.
 */

const MARKER = 'ZEBRA-PROMPT-CONTENT-4411';
const schema = z.object({ echo: z.string(), length: z.number() });
registerMockBuilder('test_echo', (input) => ({
  echo: `${String(input.note)} OUTPUT`,
  length: String(input.note).length,
}));

const input = { note: MARKER };
const call = () =>
  generateJson({
    feature: 'clinical_summary',
    promptVersion: 'test.v1',
    schemaName: 'test_echo',
    system: `System prompt ${MARKER}`,
    input,
    userMessage: JSON.stringify(input),
    schema,
    user: null,
  });

async function failure(): Promise<AiCallError> {
  try {
    await call();
  } catch (err) {
    expect(err).toBeInstanceOf(AiCallError);
    return err as AiCallError;
  }
  throw new Error('expected the call to fail');
}

const rows = () => AiInteraction.find().sort({ attempt: 1 }).lean();
const chain = modelChain();
const [primary, firstFallback] = chain as [string, string];

beforeEach(async () => {
  await resetDb();
  resetMock();
});

describe('ai.service – one call', () => {
  it('uses the main model when it answers, with one row per attempt', async () => {
    expect(chain.length).toBeGreaterThanOrEqual(2);
    const result = await call();
    expect(result).toMatchObject({
      data: { echo: `${MARKER} OUTPUT` },
      model: primary,
      isFallback: false,
      attempts: 1,
      retried: false,
      provider: 'mock',
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      callId: result.callId,
      attempt: 1,
      model: primary,
      isFallback: false,
      status: 'success',
      provider: 'mock',
      promptVersion: 'test.v1',
    });
    expect(row!.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.interactionId?.toString()).toBe(row!._id.toString());
  });

  it('retries invalid JSON once on the same model with the problems, then succeeds', async () => {
    setMockBehaviour('invalid', { times: 1 });
    const result = await call();
    expect(result).toMatchObject({ model: primary, attempts: 2, retried: true, isFallback: false });
    const payloads = mockPayloads();
    expect(payloads.map((p) => p.model)).toEqual([primary, primary]);
    expect(payloads[1]!.user).toMatch(/previous reply could not be used/);
    expect((await rows()).map((r) => [r.attempt, r.status, r.errorReason ?? null])).toEqual([
      [1, 'failed', 'invalid_output'],
      [2, 'success', null],
    ]);
  });

  it('falls back to the next model after invalid output twice, and records the model used', async () => {
    setMockBehaviour('invalid', { model: primary });
    const result = await call();
    expect(result).toMatchObject({ model: firstFallback, isFallback: true, attempts: 3 });
    expect((await rows()).map((r) => [r.model, r.isFallback, r.status])).toEqual([
      [primary, false, 'failed'],
      [primary, false, 'failed'],
      [firstFallback, true, 'success'],
    ]);
  });

  it('503 AI_OUTPUT_INVALID when every model keeps answering invalid output', async () => {
    setMockBehaviour('invalid');
    const err = await failure();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('AI_OUTPUT_INVALID');
    expect(err.attempts).toBe(chain.length * 2);
    expect(await AiInteraction.countDocuments({ status: 'failed' })).toBe(chain.length * 2);
  });

  it('moves on after a 429 without retrying the same model', async () => {
    setMockBehaviour('rate_limited', { model: primary });
    const result = await call();
    expect(result).toMatchObject({ model: firstFallback, isFallback: true, attempts: 2 });
    expect((await rows()).map((r) => r.errorReason ?? null)).toEqual(['rate_limited', null]);
  });

  it('503 AI_UNAVAILABLE "busy" with retryAfter when every model is rate limited', async () => {
    setMockBehaviour('rate_limited');
    const err = await failure();
    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(err.message).toBe('The AI is busy, try again in a minute');
    expect(err.details).toEqual({ retryAfter: MOCK_RETRY_AFTER_SECONDS });
    expect(await AiInteraction.countDocuments()).toBe(chain.length);
  });

  it('timeouts and server errors move on, and fail as AI_UNAVAILABLE when nothing answers', async () => {
    setMockRules([{ mode: 'timeout', model: primary }]);
    expect((await call()).model).toBe(firstFallback);
    resetMock();
    await resetDb();
    setMockRules([{ mode: 'timeout' }]);
    const err = await failure();
    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(err.message).toMatch(/not available/);
    expect(err.reasons).toEqual(chain.map(() => 'timeout'));
    resetMock();
    setMockRules([{ mode: 'error', model: primary }, { mode: 'invalid' }]);
    expect((await failure()).code).toBe('AI_UNAVAILABLE'); // mixed failures
  });

  it('writes one ai.call audit entry per call', async () => {
    setMockBehaviour('invalid', { times: 1 });
    const result = await call();
    await flushAudit();
    const entries = await AuditLog.find({ action: 'ai.call' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toMatchObject({
      callId: result.callId,
      feature: 'clinical_summary',
      attempts: 2,
      models: [primary],
      failures: ['invalid_output'],
    });
  });
});

describe('ai.service – daily budget', () => {
  const filler = (createdAt: Date, n: number) =>
    // Raw inserts: ai_interactions is append-only through Mongoose, and this is setup only.
    AiInteraction.collection.insertMany(
      Array.from({ length: n }, (_, i) => ({
        callId: `filler-${createdAt.getTime()}-${i}`,
        attempt: 1,
        feature: 'clinical_summary',
        provider: 'mock',
        promptVersion: 'test.v1',
        inputHash: 'a'.repeat(64),
        status: 'success',
        createdAt,
      })),
    );

  it('refuses with 503 once today’s attempts reach AI_DAILY_CALL_LIMIT (yesterday’s do not count)', async () => {
    const limit = config.ai.dailyCallLimit;
    await filler(new Date(Date.now() - 3 * 86_400_000), 5);
    await filler(new Date(), limit - 1);
    expect(await callsToday()).toBe(limit - 1);
    await call(); // the last allowed attempt
    const err = await failure();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('AI_UNAVAILABLE');
    expect(err.message).toBe('Daily AI limit reached');
    expect(mockPayloads()).toHaveLength(1); // the refused call never reached the provider
  });

  it('stops a fallback chain at the limit', async () => {
    await filler(new Date(), config.ai.dailyCallLimit - 1);
    setMockBehaviour('rate_limited');
    const err = await failure();
    expect(err.message).toBe('Daily AI limit reached');
    expect(mockPayloads()).toHaveLength(1);
  });
});

describe('ai.service – privacy', () => {
  it('keeps prompts and outputs out of logs, ai_interactions and audit entries', async () => {
    const spies = (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) =>
      vi.spyOn(logger, level),
    );
    try {
      await call();
      setMockBehaviour('invalid', { times: 1 });
      await call();
      setMockBehaviour('rate_limited');
      await failure();
      await flushAudit();
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain(MARKER);
      expect(JSON.stringify(await AiInteraction.find().lean())).not.toContain(MARKER);
      expect(JSON.stringify(await AuditLog.find().lean())).not.toContain(MARKER);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
