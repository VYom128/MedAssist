import { AI_GUARDRAIL_FLAGS, AI_RULES } from '../../config/constants.js';
import type { SummaryInput, SummaryOutput } from '../prompts/clinicalSummary.v1.js';

/**
 * Server checks on a generated clinical summary (spec §9.2), run before the draft is saved:
 * - every diagnosis in `assessment` must match a diagnosis the doctor documented (fuzzy match on
 *   the words, or the ICD-10 code); unmatched ones are removed and flagged;
 * - every `medications` line must name a prescribed drug (brand or generic); others are removed
 *   and flagged.
 * Then `renderFinalText` turns the checked draft into the editable text. Pure functions.
 */

export interface CheckResult {
  draft: SummaryOutput;
  flags: string[];
}

/** Words that say nothing about which diagnosis is meant. */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'with',
  'without',
  'in',
  'on',
  'to',
  'for',
  'due',
  'type',
  'documented',
  'diagnosis',
  'diagnoses',
  'provisional',
  'final',
  'differential',
  'primary',
  'secondary',
  'likely',
  'possible',
  'probable',
  'suspected',
  'query',
  'unspecified',
]);

const ICD10 = /\b[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?\b/gi;

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(ICD10, ' ')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Levenshtein distance, capped (enough to tell "pharyngitis" from "pharingitis"). */
function distance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const v = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Same word, allowing plurals/endings ("infection"/"infections") and small typos. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 5 && longer.startsWith(shorter.slice(0, Math.max(5, shorter.length - 2)))) {
    return true;
  }
  return shorter.length >= 6 && distance(a, b, 2) <= (shorter.length >= 9 ? 2 : 1);
}

/** Share of `part`'s words found in `of`. */
function coverage(part: string[], of: string[]): number {
  if (part.length === 0) return 1;
  return part.filter((w) => of.some((o) => sameWord(w, o))).length / part.length;
}

/**
 * True when a diagnosis phrase from the summary matches one of the documented diagnoses: the
 * same ICD-10 code, or most of the phrase's words in the diagnosis (or the other way round).
 */
export function matchesDocumentedDiagnosis(
  phrase: string,
  documented: SummaryInput['diagnoses'],
): boolean {
  const codes = (phrase.match(ICD10) ?? []).map((c) => c.toUpperCase());
  const words = tokens(phrase);
  if (words.length === 0 && codes.length === 0) return true; // nothing diagnostic in it
  return documented.some((d) => {
    if (d.icd10Code && codes.includes(d.icd10Code.toUpperCase())) return true;
    if (words.length === 0) return false;
    const dWords = tokens(d.description);
    return coverage(words, dWords) >= 0.75 || (dWords.length > 0 && coverage(dWords, words) >= 1);
  });
}

const NONE_DOCUMENTED = /^no (documented )?diagnos[ie]s( (was|were))?( documented)?\.?$/i;
const PREFIX =
  /^documented\s+(?:provisional|final|differential|primary|secondary)?\s*diagnos[ie]s\s*:\s*/i;

/** Splits `assessment` into sentences, each "Documented … diagnosis: a, b and c". */
export function checkAssessment(
  assessment: string,
  documented: SummaryInput['diagnoses'],
): { text: string; removed: number } {
  const sentences = assessment
    .split(/(?<=[.;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let removed = 0;
  const kept: string[] = [];
  for (const sentence of sentences) {
    const body = sentence.replace(/[.;]+$/, '').trim();
    if (NONE_DOCUMENTED.test(body)) {
      if (documented.length === 0) kept.push(sentence);
      continue;
    }
    const prefix = PREFIX.exec(body)?.[0] ?? '';
    const parts = body
      .slice(prefix.length)
      .split(/\s*,\s*|\s+and\s+|\s*\/\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const ok = parts.filter((p) => matchesDocumentedDiagnosis(p, documented));
    removed += parts.length - ok.length;
    if (ok.length) kept.push(`${prefix}${ok.join(', ')}.`);
  }
  if (kept.length === 0) return { text: 'No diagnosis documented.', removed };
  return { text: kept.join(' '), removed };
}

/** The words that identify each prescribed item (brand and generic name). */
function drugKeys(prescription: SummaryInput['prescription']): string[][] {
  return (prescription?.items ?? []).flatMap((i) =>
    [i.drugName, i.genericName]
      .filter((n): n is string => Boolean(n))
      .map((n) => tokens(n).filter((w) => !/^\d/.test(w)))
      .filter((t) => t.length > 0),
  );
}

/** A medication line is kept when it names a prescribed drug (all of its name words). */
export function namesPrescribedDrug(text: string, keys: string[][]): boolean {
  const words = tokens(text);
  return keys.some((key) => key.every((k) => words.some((w) => sameWord(w, k))));
}

export function checkSummary(draft: SummaryOutput, input: SummaryInput): CheckResult {
  const flags: string[] = [];
  const assessment = checkAssessment(draft.assessment, input.diagnoses);
  if (assessment.removed > 0) flags.push(AI_GUARDRAIL_FLAGS.UNVERIFIED_DIAGNOSIS_REMOVED);

  const keys = drugKeys(input.prescription);
  const medications = draft.medications.filter((m) => namesPrescribedDrug(m, keys));
  if (medications.length < draft.medications.length) {
    flags.push(AI_GUARDRAIL_FLAGS.UNVERIFIED_MEDICATION_REMOVED);
  }
  return { draft: { ...draft, assessment: assessment.text, medications }, flags };
}

/** The checked draft as the editable plain text (empty sections left out), ≤ 4000 characters. */
export function renderFinalText(d: SummaryOutput): string {
  const list = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}` : null;
  const one = (title: string, text: string) => (text.trim() ? `${title}: ${text.trim()}` : null);
  const text = [
    d.oneLineSummary,
    one('Presenting complaint', d.presentingComplaint),
    list('Key findings', d.keyFindings),
    list('Vitals', d.vitalsHighlights),
    one('Assessment', d.assessment),
    list('Plan', d.plan),
    list('Medications', d.medications),
    list('Investigations', d.investigations),
    one('Follow-up', d.followUp),
    list('For the clinician', d.flagsForClinician),
  ]
    .filter(Boolean)
    .join('\n\n');
  return text.length <= AI_RULES.finalTextMax
    ? text
    : `${text.slice(0, AI_RULES.finalTextMax - 1)}…`;
}
