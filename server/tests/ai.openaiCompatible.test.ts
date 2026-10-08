import { z } from 'zod';
import {
  createOpenAiCompatibleProvider,
  isOpenRouter,
  retryAfterSeconds,
} from '../src/ai/providers/openaiCompatible.js';
import { AiProviderError } from '../src/ai/providers/types.js';
import { extractJson } from '../src/ai/json.js';
import { logger } from '../src/utils/logger.js';

/**
 * The OpenAI-compatible provider with a stubbed fetch (spec §9.1): request shape, headers,
 * reading only message.content, JSON extraction and error mapping. No network.
 */

const KEY = 'gsk_test_secret_key_never_logged_0123456789';
const schema = z.object({ answer: z.string(), count: z.number() });

interface Captured {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

function completion(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-1',
    model: 'openai/gpt-oss-120b',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    ...extra,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function setup(
  respond: (c: Captured) => Response | Promise<Response>,
  options: { baseUrl?: string; timeoutMs?: number; apiKey?: string } = {},
) {
  const calls: Captured[] = [];
  const fakeFetch = (async (url: string, init: Captured['init']) => {
    const c = { url, init };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  const provider = createOpenAiCompatibleProvider({
    baseUrl: options.baseUrl ?? 'https://api.groq.com/openai/v1/',
    apiKey: 'apiKey' in options ? options.apiKey : KEY,
    timeoutMs: options.timeoutMs ?? 5000,
    temperature: 0.2,
    fetch: fakeFetch,
  });
  const ask = () =>
    provider.generateJson({
      system: 'SYSTEM-PROMPT',
      user: 'USER-MESSAGE',
      schema,
      schemaName: 'test',
      maxTokens: 900,
      model: 'openai/gpt-oss-120b',
    });
  return { calls, ask };
}

async function failure(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AiProviderError);
    return err as AiProviderError;
  }
  throw new Error('expected the call to fail');
}

describe('openai_compatible provider', () => {
  it('posts the chat-completions request with the key, JSON mode and the settings', async () => {
    const { calls, ask } = setup(() => json(200, completion('{"answer":"ok","count":2}')));
    const result = await ask();
    expect(result).toMatchObject({
      data: { answer: 'ok', count: 2 },
      model: 'openai/gpt-oss-120b',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Captured];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: 'SYSTEM-PROMPT' },
        { role: 'user', content: 'USER-MESSAGE' },
      ],
      temperature: 0.2,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    });
  });

  it('adds the OpenRouter headers only for openrouter.ai', async () => {
    const { calls, ask } = setup(() => json(200, completion('{"answer":"ok","count":1}')), {
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    await ask();
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]!.init.headers['HTTP-Referer']).toEqual(expect.any(String));
    expect(calls[0]!.init.headers['X-Title']).toBe('MedAssist');
    expect(isOpenRouter('https://api.groq.com/openai/v1')).toBe(false);
    expect(isOpenRouter('https://openrouter.ai.evil.example/api')).toBe(false);
  });

  it('reads only message.content: code fences, text around it and reasoning are ignored', async () => {
    const { ask } = setup(() =>
      json(
        200,
        completion('Here you go:\n```json\n{"answer":"fenced","count":3}\n```\nThanks!', {
          choices: [
            {
              message: {
                content: 'Here you go:\n```json\n{"answer":"fenced","count":3}\n```\nThanks!',
                reasoning: '{"answer":"from reasoning","count":99}',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      ),
    );
    expect((await ask()).data).toEqual({ answer: 'fenced', count: 3 });
    expect(
      extractJson('<think>maybe {"answer":"no"}</think> Sure: {"answer":"a {b}","count":1} done'),
    ).toEqual({ answer: 'a {b}', count: 1 });
  });

  it('records the model that answered', async () => {
    const { ask } = setup(() =>
      json(200, completion('{"answer":"ok","count":1}', { model: 'openai/gpt-oss-120b-2026' })),
    );
    expect((await ask()).model).toBe('openai/gpt-oss-120b-2026');
  });

  it('reports unusable replies as invalid_output with the validation problems only', async () => {
    const notJson = await failure(setup(() => json(200, completion('I cannot help'))).ask());
    expect(notJson.reason).toBe('invalid_output');
    const wrongShape = await failure(
      setup(() => json(200, completion('{"answer":"x","count":"SECRET-VALUE"}'))).ask(),
    );
    expect(wrongShape.reason).toBe('invalid_output');
    expect(wrongShape.issues).toMatch(/count/);
    expect(wrongShape.issues).not.toMatch(/SECRET-VALUE/);
    expect(wrongShape.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    const empty = await failure(setup(() => json(200, completion(null))).ask());
    expect(empty.reason).toBe('invalid_output');
    const groqJsonMode = await failure(
      setup(() =>
        json(400, {
          error: { code: 'json_validate_failed', message: 'SECRET in failed_generation' },
        }),
      ).ask(),
    );
    expect(groqJsonMode.reason).toBe('invalid_output');
    const cut = await failure(
      setup(() =>
        json(200, {
          ...completion('{"answer":"cut'),
          choices: [{ message: { content: '{"answer":"cut' }, finish_reason: 'length' }],
        }),
      ).ask(),
    );
    expect(cut.reason).toBe('truncated');
  });

  it('maps HTTP errors: 429 (+ Retry-After), 401/403, 5xx, other 4xx', async () => {
    const limited = await failure(
      setup(() => json(429, { error: { message: 'slow down' } }, { 'retry-after': '17' })).ask(),
    );
    expect(limited).toMatchObject({ reason: 'rate_limited', retryAfterSeconds: 17 });
    expect((await failure(setup(() => json(401, {})).ask())).reason).toBe('auth');
    expect((await failure(setup(() => json(403, {})).ask())).reason).toBe('auth');
    expect((await failure(setup(() => json(503, {})).ask())).reason).toBe('server_error');
    expect((await failure(setup(() => json(500, {})).ask())).reason).toBe('server_error');
    expect((await failure(setup(() => json(404, {})).ask())).reason).toBe('bad_request');
    expect(retryAfterSeconds('3.2')).toBe(4);
    expect(retryAfterSeconds(new Date(Date.now() + 30_000).toUTCString())).toBeGreaterThan(25);
    expect(retryAfterSeconds('soon')).toBeUndefined();
  });

  it('times out with its AbortController and reports network errors', async () => {
    const slow = setup(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      { timeoutMs: 20 },
    );
    expect((await failure(slow.ask())).reason).toBe('timeout');
    const offline = setup(() => {
      throw new TypeError('fetch failed');
    });
    expect((await failure(offline.ask())).reason).toBe('network');
  });

  it('never calls the API without a key, and never logs the key, prompt or reply', async () => {
    const noKey = setup(() => json(200, completion('{"answer":"ok","count":1}')), {
      apiKey: undefined,
    });
    expect((await failure(noKey.ask())).reason).toBe('auth');
    expect(noKey.calls).toHaveLength(0);

    const warn = vi.spyOn(logger, 'warn');
    try {
      await failure(setup(() => json(401, { error: { message: `bad key ${KEY}` } })).ask());
      await failure(setup(() => json(200, completion('{"answer":"SECRET-REPLY"}'))).ask());
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toMatch(/AI provider auth failed/);
      expect(logged).not.toContain(KEY);
      expect(logged).not.toMatch(/SYSTEM-PROMPT|USER-MESSAGE|SECRET-REPLY/);
    } finally {
      warn.mockRestore();
    }
  });

  it('uses the global fetch by default – which tests block', async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: KEY,
      timeoutMs: 1000,
      temperature: 0.2,
    });
    const err = await failure(
      provider.generateJson({
        system: 's',
        user: 'u',
        schema,
        schemaName: 'test',
        maxTokens: 100,
        model: 'm',
      }),
    );
    expect(err.reason).toBe('network');
  });
});
