import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiQueryError, type FieldError } from './http';

/**
 * Puts server VALIDATION_ERROR details (`[{ field: 'body.email', message }]`) on the matching
 * form fields. A server path inside a field (`body.workingDays.0`) goes to that field
 * (`workingDays`); the longest matching field wins.
 * @returns true if at least one field error was applied (so no general alert is needed).
 */
export function applyServerFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  /** Server field name → form field name, where they differ. */
  rename: Record<string, Path<T>> = {},
): boolean {
  if (!isApiQueryError(err) || err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) {
    return false;
  }
  let applied = false;
  for (const detail of err.details as FieldError[]) {
    const serverName = detail.field.replace(/^body\./, '');
    const renamed = Object.entries(rename).find(
      ([from]) => serverName === from || serverName.startsWith(`${from}.`),
    );
    const path = renamed ? serverName.replace(renamed[0], renamed[1]) : serverName;
    const name = [...fields]
      .filter((f) => path === f || path.startsWith(`${f}.`))
      .sort((a, b) => b.length - a.length)[0];
    if (name) {
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

/**
 * Like applyServerFieldErrors, for forms with dynamic fields (field arrays): `toField` maps each
 * server path (without `body.`) to a form path, or null to skip it.
 * @returns true if at least one field error was applied.
 */
export function applyServerFieldErrorsByPath<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  toField: (path: string) => string | null,
): boolean {
  if (!isApiQueryError(err) || err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) {
    return false;
  }
  let applied = false;
  for (const detail of err.details as FieldError[]) {
    const name = toField(detail.field.replace(/^body\./, ''));
    if (name) {
      setError(name as Path<T>, { type: 'server', message: detail.message });
      applied = true;
    }
  }
  return applied;
}
