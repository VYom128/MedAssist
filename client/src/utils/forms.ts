import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiQueryError, type FieldError } from './http';

/**
 * Puts server VALIDATION_ERROR details (`[{ field: 'body.email', message }]`) on the matching
 * form fields.
 * @returns true if at least one field error was applied (so no general alert is needed).
 */
export function applyServerFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!isApiQueryError(err) || err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) {
    return false;
  }
  let applied = false;
  for (const detail of err.details as FieldError[]) {
    const name = detail.field.replace(/^body\./, '') as Path<T>;
    if (fields.includes(name)) {
      setError(name, { type: 'server', message: detail.message });
      applied = true;
    }
  }
  return applied;
}

/** Only allow same-app paths as a post-login redirect (blocks //evil.com and absolute URLs). */
export function safeNextPath(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}
