import { config } from '../../config/env.js';
import type { AiFailureReason } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';
import { parseJsonReply } from '../json.js';
import {
  AiProviderError,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateJsonResult,
  type TokenUsage,
} from './types.js';

/**
 * A generic OpenAI-compatible chat-completions provider (spec §9.1): Groq, OpenRouter and the
 * like, chosen by AI_BASE_URL alone – no vendor SDK. One call = one HTTP request with Node's
 * fetch and an AbortController deadline; JSON mode (`response_format: json_object`); only
 * `choices[0].message.content` is read (a reasoning field is ignored).
 *
 * Failures are logged with the model, HTTP status and a reason tag only – never the key, the
 * prompt, the reply or the provider's error message (it can echo input).
 */

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
  temperature: number;
  /** Defaults to the global fetch at call time (tests stub it). */
  fetch?: typeof fetch;
}

interface ChatCompletion {
  model?: unknown;
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** OpenRouter's optional attribution headers – sent to openrouter.ai only. */
export function isOpenRouter(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

/** Retry-After as seconds (delta-seconds or an HTTP date); undefined when absent or invalid. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

function reasonForStatus(status: number, errorCode: string | undefined): AiFailureReason {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  // Groq answers 400 json_validate_failed when the model's output was not valid JSON.
  if (status === 400 && errorCode === 'json_validate_failed') return 'invalid_output';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function usageOf(body: ChatCompletion): TokenUsage {
  return {
    inputTokens: num(body.usage?.prompt_tokens),
    outputTokens: num(body.usage?.completion_tokens),
  };
}

/** The provider's error code (e.g. 'json_validate_failed') – the code only, never the message. */
async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code.slice(0, 60) : undefined;
  } catch {
    return undefined;
  }
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AiProvider {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const openRouter = isOpenRouter(options.baseUrl);

  function fail(
    reason: AiFailureReason,
    info: ConstructorParameters<typeof AiProviderError>[1],
    status?: number,
  ): never {
    logger.warn(
      { ai: { provider: 'openai_compatible', model: info.model, reason, status } },
      reason === 'auth' ? 'AI provider auth failed' : 'AI provider call failed',
    );
    throw new AiProviderError(reason, info);
  }

  return {
    name: 'openai_compatible',

    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> {
      const { model } = request;
      if (!options.apiKey) fail('auth', { model });
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (openRouter) {
        headers['HTTP-Referer'] = config.clientUrl;
        headers['X-Title'] = 'MedAssist';
      }
      const body = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        temperature: options.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: 'json_object' },
      });

      const started = Date.now();
      const elapsed = () => Date.now() - started;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      let res: Response;
      let reply: ChatCompletion;
      try {
        const doFetch = options.fetch ?? globalThis.fetch;
        try {
          res = await doFetch(url, { method: 'POST', headers, body, signal: controller.signal });
        } catch {
          fail(controller.signal.aborted ? 'timeout' : 'network', {
            model,
            latencyMs: elapsed(),
          });
        }
        if (!res.ok) {
          const reason = reasonForStatus(res.status, await errorCodeOf(res));
          fail(
            reason,
            {
              model,
              latencyMs: elapsed(),
              retryAfterSeconds:
                reason === 'rate_limited'
                  ? retryAfterSeconds(res.headers.get('retry-after'))
                  : undefined,
              issues: reason === 'invalid_output' ? 'the reply was not valid JSON' : undefined,
            },
            res.status,
          );
        }
        try {
          reply = (await res.json()) as ChatCompletion;
        } catch {
          fail(controller.signal.aborted ? 'timeout' : 'invalid_output', {
            model,
            latencyMs: elapsed(),
            issues: 'the response was not JSON',
          });
        }
      } finally {
        clearTimeout(timer);
      }

      const usage = usageOf(reply);
      const answeredBy = typeof reply.model === 'string' && reply.model ? reply.model : model;
      const choice = reply.choices?.[0];
      const info = { model: answeredBy, usage, latencyMs: elapsed() };
      if (choice?.finish_reason === 'length') {
        fail('truncated', { ...info, issues: 'the reply was cut off before it ended' });
      }
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        fail('invalid_output', { ...info, issues: 'the reply was empty' });
      }
      const parsed = parseJsonReply(content, request.schema);
      if (!parsed.ok) fail('invalid_output', { ...info, issues: parsed.problem });
      return { data: parsed.data, model: answeredBy, usage, latencyMs: info.latencyMs };
    },
  };
}

/** The provider configured by the environment (AI_BASE_URL, AI_API_KEY…). */
export const openAiCompatibleProvider = createOpenAiCompatibleProvider({
  baseUrl: config.ai.baseUrl,
  apiKey: config.ai.apiKey,
  timeoutMs: config.ai.timeoutMs,
  temperature: config.ai.temperature,
});
