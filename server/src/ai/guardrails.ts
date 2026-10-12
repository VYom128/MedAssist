import { AI_GUARDRAIL_FLAGS as FLAGS } from '../config/constants.js';
import { FREQUENCY_PHRASES, UNIT_WORDS } from '../data/abbreviations.js';
import { FORBIDDEN_PHRASES } from '../data/forbiddenPhrases.js';
import { FORMULARY } from '../data/formulary.js';
import { escapeRegex } from '../utils/regex.js';
import type { ExplanationInput, ExplanationOutput } from './prompts/patientExplanation.v1.js';

/**
 * Server guardrails on a patient explanation (spec §9.3), pure functions:
 * 1. Consistency – every medicine in the output matches a prescribed item (normalised names) and
 *    every prescribed item is explained; no other known drug is named anywhere; every number with
 *    a unit (dose, strength, times a day, duration, hours…) is one the input supports. Devanagari
 *    digits (०-९) are read as 0-9 and Hindi unit words (दिन, गोली, मिलीलीटर…) as their units.
 * 2. Forbidden phrases – diagnosing or changing treatment, in English and Hindi
 *    (data/forbiddenPhrases.ts).
 * Any flag blocks the model's text; the caller regenerates once, then uses the template.
 */

export const toWesternDigits = (s: string) =>
  s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

/** Hindi as compared: nukta removed (ज़ = ज), chandrabindu as anusvara (बूँद = बूंद), NFC. */
export const normaliseHindi = (s: string) =>
  s.normalize('NFD').replace(/़/g, '').replace(/ँ/g, 'ं').normalize('NFC');

const norm = (s: string) => normaliseHindi(toWesternDigits(s)).toLowerCase();

/** Every word that means a unit → its canonical unit. */
const UNIT_OF = new Map<string, string>(
  Object.entries(UNIT_WORDS).flatMap(([unit, words]) => words.map((w) => [norm(w), unit])),
);

// A number, then (optionally a space or dash) a word: letters and their marks (Devanagari
// vowel signs), so "5 दिन" and "500mg" both read as number + unit.
const NUMBER_UNIT = /(\d+(?:\.\d+)?)\s*-?\s*([\p{L}\p{M}]+)/gu;

const numberKey = (n: string | number, unit: string) => `${Number(n)}|${unit}`;

/** The "number|unit" pairs in a text, e.g. "Take 1 tablet for ५ दिन" → 1|tablet, 5|day. */
export function numberUnits(text: string): string[] {
  const out: string[] = [];
  for (const m of norm(text).matchAll(NUMBER_UNIT)) {
    const unit = UNIT_OF.get(m[2]!);
    if (unit) out.push(numberKey(m[1]!, unit));
  }
  return out;
}

/** The number|unit pairs the input supports (as written, and what codes and durations imply). */
export function allowedNumberUnits(input: ExplanationInput): Set<string> {
  const allowed = new Set<string>();
  const addText = (t: string | null | undefined) => {
    if (t) for (const k of numberUnits(t)) allowed.add(k);
  };
  const addDays = (d: number | null | undefined) => {
    if (!d) return;
    allowed.add(numberKey(d, 'day'));
    if (d % 7 === 0) allowed.add(numberKey(d / 7, 'week'));
    if (d % 30 === 0) allowed.add(numberKey(d / 30, 'month'));
  };
  for (const m of input.medicines) {
    for (const t of [m.name, m.strength, m.dose, m.frequencyText, m.instructions]) addText(t);
    addDays(m.durationDays);
    const perDay = m.frequency ? FREQUENCY_PHRASES[m.frequency].timesPerDay : undefined;
    if (perDay) {
      allowed.add(numberKey(perDay, 'time'));
      allowed.add(numberKey(24 / perDay, 'hour'));
    }
    if (m.frequency === 'weekly') allowed.add(numberKey(1, 'time')).add(numberKey(1, 'week'));
  }
  addText(input.generalInstructions);
  if (input.followUp) {
    addDays(input.followUp.afterDays);
    addText(input.followUp.instructions);
  }
  return allowed;
}

/** All text of an output, one string per field. */
export function outputTexts(o: ExplanationOutput): string[] {
  return [
    o.overview,
    o.followUp,
    ...o.questionsToAskDoctor,
    ...o.medicines.flatMap((m) => [m.name, m.whatToDo, m.whenToTake, m.howLong, ...m.tips]),
  ].filter((t): t is string => Boolean(t));
}

const words = (s: string) =>
  norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The identifying first word of a drug name ("Amoxicillin" for "Amoxicillin 500 mg"). */
const keyWord = (name: string | null | undefined) =>
  words(name ?? '').find((w) => /\p{L}/u.test(w) && w.length >= 3);

/** Formulary drug words (≥ 5 letters, to avoid ordinary words) – used to spot invented drugs. */
const KNOWN_DRUG_WORDS = new Set(
  FORMULARY.flatMap((d) => [keyWord(d.name), keyWord(d.genericName)]).filter(
    (w): w is string => Boolean(w) && w!.length >= 5,
  ),
);

export function checkConsistency(output: ExplanationOutput, input: ExplanationInput): string[] {
  const flags = new Set<string>();
  const keysOf = input.medicines.map((m) =>
    [keyWord(m.name), keyWord(m.genericName)].filter((w): w is string => Boolean(w)),
  );
  const prescribedWords = new Set(keysOf.flat());

  // Each output medicine is one of the prescribed items; each prescribed item is explained.
  const explained = new Set<number>();
  for (const m of output.medicines) {
    const w = new Set(words(m.name));
    const index = keysOf.findIndex((keys) => keys.some((k) => w.has(k)));
    if (index < 0) flags.add(FLAGS.MEDICINE_NOT_PRESCRIBED);
    else explained.add(index);
  }
  if (explained.size < input.medicines.length) flags.add(FLAGS.MEDICINE_MISSING);

  // No other known drug is named anywhere in the text.
  const texts = outputTexts(output);
  for (const w of texts.flatMap(words)) {
    if (KNOWN_DRUG_WORDS.has(w) && !prescribedWords.has(w))
      flags.add(FLAGS.MEDICINE_NOT_PRESCRIBED);
  }

  // Every number with a unit is supported by the input.
  const allowed = allowedNumberUnits(input);
  if (texts.flatMap(numberUnits).some((k) => !allowed.has(k))) flags.add(FLAGS.NUMBER_MISMATCH);
  return [...flags];
}

const EN_PHRASES = FORBIDDEN_PHRASES.en.map((p) => ({
  phrase: p,
  re: new RegExp(`(?<![a-z])${escapeRegex(p)}`, 'i'),
}));
const HI_PHRASES = FORBIDDEN_PHRASES.hi.map(normaliseHindi);

/** The forbidden phrases (English and Hindi) a text contains. */
export function forbiddenPhrasesIn(text: string): string[] {
  const t = text.replace(/[’‘]/g, "'");
  const hindi = normaliseHindi(t);
  return [
    ...EN_PHRASES.filter(({ re }) => re.test(t)).map(({ phrase }) => phrase),
    ...HI_PHRASES.filter((p) => hindi.includes(p)),
  ];
}

export const hasForbiddenPhrase = (text: string) => forbiddenPhrasesIn(text).length > 0;

/** The doctor's own free text – a phrase the doctor wrote ("stop taking if…") may be restated. */
function inputTexts(input: ExplanationInput): string[] {
  return [
    input.generalInstructions,
    input.followUp?.instructions,
    ...input.medicines.flatMap((m) => [m.instructions, m.frequencyText]),
  ].filter((t): t is string => Boolean(t));
}

export function checkForbidden(output: ExplanationOutput, input?: ExplanationInput): string[] {
  const written = new Set(input ? inputTexts(input).flatMap(forbiddenPhrasesIn) : []);
  const found = outputTexts(output)
    .flatMap(forbiddenPhrasesIn)
    .filter((p) => !written.has(p));
  return found.length ? [FLAGS.FORBIDDEN_PHRASE] : [];
}

/** All guardrail flags for an output (empty = safe to show). */
export function checkExplanation(output: ExplanationOutput, input: ExplanationInput): string[] {
  return [...checkConsistency(output, input), ...checkForbidden(output, input)];
}
