import { extractJson, parseJsonReply } from '../json.js';
import {
  AiProviderError,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateJsonResult,
} from './types.js';

/**
 * Mock provider (spec §9.1, §9.4): deterministic replies built only from the de-identified input
 * in the user message; no network. Dev, the seed and every test use it. Its replies go through
 * the same JSON extraction and Zod validation as a real provider's.
 *
 * Tests steer it with `setMockBehaviour(mode, { times, model })` or a list of rules
 * (`setMockRules`); the first rule matching the requested model (and with calls left) applies,
 * otherwise 'ok':
 * - 'ok'           – a valid, faithful reply
 * - 'invalid'      – a reply that is not JSON (→ invalid output)
 * - 'unsafe'       – valid JSON with unsafe content (an invented diagnosis, an unprescribed drug…)
 *                    that the server checks must remove or block
 * - 'error'        – a 5xx server error
 * - 'rate_limited' – 429 with Retry-After 20 s
 * - 'timeout'      – the call times out
 */
export type MockMode = 'ok' | 'invalid' | 'unsafe' | 'error' | 'rate_limited' | 'timeout';

/** Builds a reply object from the parsed input (registered per schema name by each prompt). */
export type MockBuilder = (input: Record<string, unknown>, mode: 'ok' | 'unsafe') => unknown;

interface Rule {
  mode: MockMode;
  /** Only calls to this model (default: any). */
  model?: string;
  /** Calls left (default: unlimited). */
  times?: number;
}

/** What the mock received – exactly what a real provider would have been sent. */
export interface MockPayload {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  maxTokens: number;
}

export const MOCK_RETRY_AFTER_SECONDS = 20;

let rules: Rule[] = [];
const payloads: MockPayload[] = [];
const builders = new Map<string, MockBuilder>();

export function setMockRules(next: Rule[]): void {
  rules = next.map((r) => ({ ...r }));
}

export function setMockBehaviour(mode: MockMode, options: Omit<Rule, 'mode'> = {}): void {
  setMockRules([{ mode, ...options }]);
}

export function resetMock(): void {
  rules = [];
  payloads.length = 0;
}

/** Every payload since the last reset, oldest first. */
export function mockPayloads(): readonly MockPayload[] {
  return payloads;
}

export function lastPayload(): MockPayload | null {
  return payloads.at(-1) ?? null;
}

export function registerMockBuilder(schemaName: string, builder: MockBuilder): void {
  builders.set(schemaName, builder);
}

function modeFor(model: string): MockMode {
  const rule = rules.find(
    (r) => (r.model === undefined || r.model === model) && (r.times ?? Infinity) > 0,
  );
  if (!rule) return 'ok';
  if (rule.times !== undefined) rule.times -= 1;
  return rule.mode;
}

const tokens = (text: string) => Math.ceil(text.length / 4);

export const mockProvider: AiProvider = {
  name: 'mock',

  async generateJson<T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> {
    const { model } = request;
    payloads.push({
      model,
      system: request.system,
      user: request.user,
      schemaName: request.schemaName,
      maxTokens: request.maxTokens,
    });
    const mode = modeFor(model);
    if (mode === 'error') throw new AiProviderError('server_error', { model });
    if (mode === 'timeout') throw new AiProviderError('timeout', { model });
    if (mode === 'rate_limited') {
      throw new AiProviderError('rate_limited', {
        model,
        retryAfterSeconds: MOCK_RETRY_AFTER_SECONDS,
      });
    }
    const builder = builders.get(request.schemaName);
    if (!builder) throw new AiProviderError('bad_request', { model });

    const text =
      mode === 'invalid'
        ? 'Sorry, here is the summary you asked for (not JSON).'
        : JSON.stringify(builder(extractJson(request.user) as Record<string, unknown>, mode));
    const usage = {
      inputTokens: tokens(request.system + request.user),
      outputTokens: tokens(text),
    };
    const parsed = parseJsonReply(text, request.schema);
    if (!parsed.ok) {
      throw new AiProviderError('invalid_output', { model, usage, issues: parsed.problem });
    }
    return { data: parsed.data, model, usage, latencyMs: 1 };
  },
};
