import { SEQUENCES } from '../config/constants.js';
import { formatNumber } from '../services/counter.service.js';
import { tryNormalisePhone } from './phone.js';
import { escapeRegex } from './regex.js';

export { escapeRegex };

/** 'MRN-000123', 'mrn 123', 'MRN123' */
const MRN_PATTERN = /^mrn[\s-]?(\d{1,9})$/i;
/** Digits with optional +, spaces, dashes, dots or brackets, and at least 7 digits. */
const PHONE_PATTERN = /^\+?[\d\s\-().]{7,}$/;
const MAX_WORDS = 4;

/** Matches no document (a search term that can only be a phone number but is not a valid one). */
const MATCH_NOTHING = { _id: { $exists: false } };

type Filter = Record<string, unknown>;

/**
 * Patient search (spec §12.1), without leading-wildcard regexes so indexes can be used:
 * - an MRN ('MRN-000123', 'mrn 123') → exact `mrn`;
 * - something that looks like a phone number (any common format) → exact E.164 `phone`;
 * - otherwise each word must be a case-insensitive prefix of `firstName` or `lastName`
 *   ('pri sha' finds Priya Sharma).
 * @returns a Mongo filter, or null for an empty query.
 */
export function buildPatientSearchQuery(q: string): Filter | null {
  const term = q.trim();
  if (!term) return null;

  const mrn = MRN_PATTERN.exec(term);
  if (mrn) return { mrn: formatNumber(SEQUENCES.MRN.prefix, Number(mrn[1])) };

  if (PHONE_PATTERN.test(term) && (term.match(/\d/g)?.length ?? 0) >= 7) {
    const phone = tryNormalisePhone(term);
    return phone ? { phone } : MATCH_NOTHING;
  }

  const words = term.split(/\s+/).slice(0, MAX_WORDS);
  const clauses = words.map((word) => {
    const prefix = new RegExp(`^${escapeRegex(word)}`, 'i');
    return { $or: [{ firstName: prefix }, { lastName: prefix }] };
  });
  return clauses.length === 1 ? clauses[0]! : { $and: clauses };
}
