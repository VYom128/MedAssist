import { isApiQueryError } from '../../utils/http';

/**
 * AI failures in plain words (spec §16: AI_DISABLED, AI_UNAVAILABLE, AI_OUTPUT_INVALID). The
 * server tells "busy" (the provider rate-limited us) and "daily limit" apart from a plain outage
 * by its message and `details`.
 */
export type AiErrorKind =
  'disabled' | 'busy' | 'daily_limit' | 'unavailable' | 'invalid' | 'rate_limited' | 'other';

export interface AiErrorInfo {
  kind: AiErrorKind;
  message: string;
  /** Trying again soon may work. */
  retry: boolean;
}

const TEXT: Record<Exclude<AiErrorKind, 'other'>, Omit<AiErrorInfo, 'kind'>> = {
  disabled: { message: 'AI features are turned off.', retry: false },
  busy: { message: 'The AI is busy – try again in a minute.', retry: true },
  daily_limit: {
    message: 'Daily AI limit reached – AI is available again tomorrow.',
    retry: false,
  },
  unavailable: {
    message: 'The AI service is not available right now – try again later.',
    retry: true,
  },
  invalid: { message: 'The AI could not produce a usable answer.', retry: true },
  rate_limited: {
    message: 'Too many AI requests – please wait a little and try again.',
    retry: true,
  },
};

export function aiErrorKind(err: unknown): AiErrorKind {
  if (!isApiQueryError(err)) return 'other';
  const details = (err.details ?? {}) as { reason?: unknown; retryAfter?: unknown };
  switch (err.code) {
    case 'AI_DISABLED':
      return 'disabled';
    case 'AI_OUTPUT_INVALID':
      return 'invalid';
    case 'AI_UNAVAILABLE':
      if (details.reason === 'daily_limit' || /daily ai limit/i.test(err.message)) {
        return 'daily_limit';
      }
      if (details.retryAfter !== undefined || /busy/i.test(err.message)) return 'busy';
      return 'unavailable';
    case 'RATE_LIMITED':
      return 'rate_limited';
    default:
      return err.status === 429 ? 'rate_limited' : 'other';
  }
}

export function aiError(err: unknown): AiErrorInfo {
  const kind = aiErrorKind(err);
  if (kind === 'other') {
    return {
      kind,
      message: isApiQueryError(err) ? err.message : 'Something went wrong',
      retry: true,
    };
  }
  return { kind, ...TEXT[kind] };
}
