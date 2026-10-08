import { z } from 'zod';
import type {
  DrugForm,
  DrugFrequency,
  DrugRoute,
  DrugTiming,
  ExplanationLanguage,
} from '../../config/constants.js';
import { FREQUENCY_PHRASES, ROUTE_PHRASES, TIMING_PHRASES } from '../../data/abbreviations.js';
import { buildTemplateExplanation } from '../explanationTemplate.js';
import { registerMockBuilder } from '../providers/mock.js';

/**
 * Patient explanation prompt, version 1 (spec §9.3). The version is stored with every
 * explanation and ai_interactions row; a new wording → patientExplanation.v2.
 */
export const PROMPT_VERSION = 'patientExplanation.v1';
export const SCHEMA_NAME = 'patient_explanation';

export interface ExplanationMedicine {
  name: string;
  genericName: string | null;
  strength: string | null;
  form: DrugForm | null;
  dose: string | null;
  route: DrugRoute | null;
  frequency: DrugFrequency | null;
  frequencyText: string | null;
  timing: DrugTiming | null;
  durationDays: number | null;
  instructions: string | null;
}

/** The de-identified input (built by modules/explanations/input.ts). */
export interface ExplanationInput {
  language: ExplanationLanguage;
  readingAge: number;
  explains: 'prescription' | 'follow_up_plan';
  medicines: ExplanationMedicine[];
  generalInstructions: string | null;
  followUp: { afterDays: number | null; date: string | null; instructions: string | null } | null;
}

const text = (max: number) => z.string().trim().max(max);

/** The reply (spec §9.3 output schema). The server adds whenToContactClinic and the disclaimer. */
export const explanationOutputSchema = z.object({
  overview: text(1000).min(1),
  medicines: z
    .array(
      z.object({
        name: text(200).min(1),
        whatToDo: text(500).default(''),
        whenToTake: text(500).default(''),
        howLong: text(300).default(''),
        tips: z.array(text(300)).max(5).default([]),
      }),
    )
    .max(20)
    .default([]),
  followUp: text(1000).default(''),
  questionsToAskDoctor: z.array(text(300)).max(5).default([]),
});
export type ExplanationOutput = z.infer<typeof explanationOutputSchema>;

const LANGUAGE_NAME: Record<ExplanationLanguage, string> = {
  en: 'simple English',
  hi: 'simple Hindi written in Devanagari script',
};

const SHAPE = `{
  "overview": "string",
  "medicines": [
    { "name": "string", "whatToDo": "string", "whenToTake": "string", "howLong": "string", "tips": ["string"] }
  ],
  "followUp": "string",
  "questionsToAskDoctor": ["string"]
}`;

const EXAMPLE = `{
  "overview": "Your doctor has given you one medicine for a few days.",
  "medicines": [
    {
      "name": "Amoxicillin 500 mg",
      "whatToDo": "Take 1 capsule by mouth.",
      "whenToTake": "Three times a day, after eating.",
      "howLong": "For 5 days.",
      "tips": ["Your doctor wrote: finish the full course."]
    }
  ],
  "followUp": "",
  "questionsToAskDoctor": ["What should I do if I miss a dose?"]
}`;

export function systemPrompt(language: ExplanationLanguage, readingAge: number): string {
  return `You explain a doctor's written instructions to a patient in simple, friendly language (target reading age ${readingAge}) in ${LANGUAGE_NAME[language]}.

Rules:
- Only restate what is written. Never diagnose, never say what illness the patient has, never suggest changing, stopping, starting, skipping or adjusting any medicine or dose, and never add medicines. Do not give medical opinions.
- Explain every medicine in the input exactly once, in the same order, in "medicines". Keep each medicine's "name" exactly as written in the input (in English letters, with its strength).
- Copy every number and unit exactly as written (for example 500 mg, 1 tablet, 5 days). Write numbers with the digits 0-9. Do not add numbers, times or hours that are not in the input.
- Convert abbreviations into plain words using the "approvedPhrases" given in the input (for example BD = two times a day, after food = after eating).
- If an instruction is unclear, say "Please ask your doctor or the clinic about this."
- "followUp" explains the follow-up plan when the input has one; otherwise it is "".
- "questionsToAskDoctor" lists at most 3 short, general questions the patient could ask (no advice).
- Reply with ONE JSON object only – no code fences, no text before or after it.

The JSON object must have exactly this shape:
${SHAPE}

Example of a valid reply in English (for a different prescription):
${EXAMPLE}`;
}

/** The approved plain-language wording of the codes the input uses, in the target language. */
function approvedPhrases(input: ExplanationInput) {
  const out: Record<string, string> = {};
  for (const m of input.medicines) {
    if (m.frequency) out[m.frequency] = FREQUENCY_PHRASES[m.frequency][input.language];
    if (m.timing) out[m.timing] = TIMING_PHRASES[m.timing][input.language];
    if (m.route) out[m.route] = ROUTE_PHRASES[m.route][input.language];
  }
  return out;
}

/** The user message: the de-identified instructions as JSON (nothing else is sent). */
export function buildUserMessage(input: ExplanationInput): string {
  return `Doctor's written instructions (JSON):\n${JSON.stringify(
    { ...input, approvedPhrases: approvedPhrases(input) },
    null,
    2,
  )}`;
}

// ---- Mock replies (deterministic, from the input only) --------------------------------------

function mockExplanation(raw: Record<string, unknown>, mode: 'ok' | 'unsafe'): ExplanationOutput {
  const input = raw as unknown as ExplanationInput;
  const out = buildTemplateExplanation(input);
  if (mode === 'ok') {
    return { ...out, questionsToAskDoctor: ['What should I do if I miss a dose?'] };
  }
  // Unsafe: diagnosis wording, an unprescribed medicine and a changed duration – the guardrails
  // must block it.
  const hi = input.language === 'hi';
  return {
    ...out,
    overview: hi ? 'आपको संक्रमण है।' : 'You have an infection.',
    medicines: [
      ...out.medicines.map((m) => ({ ...m, howLong: hi ? '7 दिन तक।' : 'For 7 days.' })),
      {
        name: 'Ibuprofen 400 mg',
        whatToDo: hi ? '1 गोली लें।' : 'Take 1 tablet.',
        whenToTake: '',
        howLong: '',
        tips: [],
      },
    ],
  };
}

registerMockBuilder(SCHEMA_NAME, mockExplanation);
