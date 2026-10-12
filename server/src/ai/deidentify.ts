import { escapeRegex } from '../utils/regex.js';
import { ageOn } from '../utils/dates.js';

/**
 * De-identification before every AI call (spec §9.1). AI inputs are built from structured data
 * only, never whole records: no name, MRN, phone, email, address or exact date of birth – age in
 * years and sex only. Free text the doctor wrote goes through `scrubText`, which replaces the
 * known names of the people involved (patient, doctor, emergency contact – first, last and full
 * names, any case) with `[name]`, and removes anything that looks like a phone number, an email
 * address or a record number (MRN-000123, APT-2026-000123…). Pure functions, no I/O.
 */

export const NAME_PLACEHOLDER = '[name]';
export const REMOVED_PLACEHOLDER = '[removed]';

export interface PersonName {
  firstName?: string | null;
  lastName?: string | null;
}

/** Name parts shorter than this are not replaced (initials would hit ordinary words). */
const MIN_NAME_LENGTH = 2;

/**
 * Every form of the known names to replace, longest first (so "Asha Verma" is replaced before
 * "Asha"): each full name, each first and last name, and each word of multi-word names.
 */
export function nameVariants(
  people: readonly (PersonName | string | null | undefined)[],
): string[] {
  const variants = new Set<string>();
  const add = (value: string | null | undefined) => {
    const v = value?.trim().replace(/\s+/g, ' ');
    if (!v || v.length < MIN_NAME_LENGTH) return;
    variants.add(v);
    for (const word of v.split(' ')) if (word.length >= MIN_NAME_LENGTH) variants.add(word);
  };
  for (const p of people) {
    if (!p) continue;
    if (typeof p === 'string') {
      add(p);
      continue;
    }
    add(p.firstName);
    add(p.lastName);
    if (p.firstName && p.lastName) add(`${p.firstName} ${p.lastName}`);
  }
  return [...variants].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

// Email addresses.
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// Phone-shaped numbers: an optional +country code and area code, then 3–5 + 4–5 digits, with
// single spaces or dashes between groups, not part of a decimal number; replaced only when they
// hold 10+ digits (so vitals such as "120 80" or "38.6" stay). A full stop after it is fine.
const PHONE =
  /(?<!\d)(?<!\d\.)(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}(?!\d|\.\d)/g;
const MIN_PHONE_DIGITS = 10;
// Record numbers such as MRN-000123, APT-2026-000045, INV-2026-000001, ENC-2026-000009.
const RECORD_NUMBER = /\b[A-Z]{2,6}-(?:\d{4}-)?\d{4,}\b/gi;

/** A compiled scrubber for one set of names (build once per input). */
export interface Scrubber {
  (text: string | null | undefined): string | null;
}

export function createScrubber(names: readonly string[]): Scrubber {
  const namePattern = names.length
    ? new RegExp(
        // Not part of a longer word (Unicode letters/digits on either side).
        `(?<![\\p{L}\\p{N}])(?:${names.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}])`,
        'giu',
      )
    : null;
  return (text) => {
    if (text === null || text === undefined) return null;
    let out = text
      .replace(EMAIL, REMOVED_PLACEHOLDER)
      .replace(RECORD_NUMBER, REMOVED_PLACEHOLDER)
      .replace(PHONE, (m) =>
        m.replace(/\D/g, '').length >= MIN_PHONE_DIGITS ? REMOVED_PLACEHOLDER : m,
      );
    if (namePattern) out = out.replace(namePattern, NAME_PLACEHOLDER);
    out = out.trim();
    return out === '' ? null : out;
  };
}

/** scrubText(text, names) – one-off form of createScrubber. */
export function scrubText(
  text: string | null | undefined,
  names: readonly string[],
): string | null {
  return createScrubber(names)(text);
}

/** Age in whole years on `today` (clinic date) and sex – the only demographics sent. */
export function demographics(
  p: { dateOfBirth?: Date | string | null; gender?: string | null },
  today: string,
): { ageYears: number | null; sex: string } {
  return {
    ageYears: p.dateOfBirth ? ageOn(p.dateOfBirth, today) : null,
    sex: p.gender ?? 'unknown',
  };
}
