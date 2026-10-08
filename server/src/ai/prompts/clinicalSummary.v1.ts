import { z } from 'zod';
import { registerMockBuilder } from '../providers/mock.js';

/**
 * Clinical summary prompt, version 1 (spec §9.2). The version is stored with every summary and
 * ai_interactions row; change the prompt → add clinicalSummary.v2 instead of editing this file.
 */
export const PROMPT_VERSION = 'clinicalSummary.v1';
export const SCHEMA_NAME = 'clinical_summary';

/** The de-identified input (built by modules/summaries/input.ts). */
export interface SummaryInput {
  patient: {
    ageYears: number | null;
    sex: string;
    allergies: { substance: string; reaction: string | null; severity: string }[];
    chronicConditions: string[];
  };
  vitals: Record<string, number>;
  chiefComplaint: string | null;
  historyOfPresentIllness: string | null;
  pastHistory: string | null;
  examination: string | null;
  diagnoses: { description: string; type: string; isPrimary: boolean; icd10Code: string | null }[];
  assessment: string | null;
  plan: string | null;
  adviceToPatient: string | null;
  prescription: {
    items: {
      drugName: string;
      genericName: string | null;
      strength: string | null;
      form: string | null;
      dose: string | null;
      route: string | null;
      frequency: string | null;
      timing: string | null;
      durationDays: number | null;
      instructions: string | null;
    }[];
    generalInstructions: string | null;
  } | null;
  labTests: {
    name: string;
    status: string;
    results: { name: string; value: string; unit: string | null; flag: string | null }[];
  }[];
  followUp: { afterDays: number | null; instructions: string | null } | null;
}

const line = z.string().trim().max(300);
const lines = z.array(line).max(20).default([]);

/** The reply (spec §9.2 output schema). Lists may be omitted (→ []). */
export const summaryOutputSchema = z.object({
  oneLineSummary: z.string().trim().min(1).max(300),
  presentingComplaint: z.string().trim().max(1000).default(''),
  keyFindings: lines,
  vitalsHighlights: lines,
  assessment: z.string().trim().max(1000).default(''),
  plan: lines,
  medications: lines,
  investigations: lines,
  followUp: z.string().trim().max(500).default(''),
  flagsForClinician: lines,
});
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

const SHAPE = `{
  "oneLineSummary": "string, at most 300 characters",
  "presentingComplaint": "string",
  "keyFindings": ["string"],
  "vitalsHighlights": ["string"],
  "assessment": "string",
  "plan": ["string"],
  "medications": ["string"],
  "investigations": ["string"],
  "followUp": "string",
  "flagsForClinician": ["string"]
}`;

const EXAMPLE = `{
  "oneLineSummary": "45-year-old male with 3 days of fever and sore throat; exam shows tonsillar exudate.",
  "presentingComplaint": "Fever and sore throat for 3 days",
  "keyFindings": ["Tonsillar exudate", "No neck stiffness"],
  "vitalsHighlights": ["Temperature 38.6 °C", "Pulse 96/min"],
  "assessment": "Documented provisional diagnosis: acute tonsillitis.",
  "plan": ["Warm saline gargles", "Review if not better in 3 days"],
  "medications": ["Amoxicillin 500 mg, 1 capsule TDS after food for 5 days"],
  "investigations": ["CBC ordered"],
  "followUp": "Review after 5 days",
  "flagsForClinician": ["Penicillin allergy status not documented"]
}`;

export const SYSTEM_PROMPT = `You are a clinical documentation assistant. Summarise ONLY the information provided in the structured visit note for a clinician.

Rules:
- Do not add diagnoses, differential diagnoses, treatment suggestions, dosages, or facts that are not present in the input.
- "assessment" restates only the diagnoses the doctor documented, one sentence each, in the form "Documented provisional diagnosis: <diagnosis>." or "Documented final diagnosis: <diagnosis>.". If none are documented, write "No diagnosis documented."
- "medications" has one line per prescribed item, naming the drug exactly as prescribed with its strength, dose, frequency and duration as written. List nothing that is not in the prescription.
- If information is missing or inconsistent (for example, allergy status not documented while an antibiotic is prescribed, or an abnormal vital sign with no comment), add a short NEUTRAL observation to "flagsForClinician". Never give advice there.
- Use concise clinical language. Use "[name]" for people; never guess names, dates of birth or contact details.
- Reply with ONE JSON object only – no code fences, no text before or after it.

The JSON object must have exactly this shape:
${SHAPE}

Example of a valid reply (for a different visit):
${EXAMPLE}`;

/** The user message: the de-identified note as JSON (nothing else is sent). */
export function buildUserMessage(input: SummaryInput): string {
  return `Structured visit note (JSON):\n${JSON.stringify(input, null, 2)}`;
}

// ---- Mock replies (deterministic, from the input only) --------------------------------------

const FREQUENCY_WORDS: Record<string, string> = {
  OD: 'OD',
  BD: 'BD',
  TDS: 'TDS',
  QID: 'QID',
  HS: 'HS',
  SOS: 'SOS',
  STAT: 'STAT',
};

function medicationLine(item: NonNullable<SummaryInput['prescription']>['items'][number]) {
  return [
    item.drugName,
    item.strength,
    item.dose ? `, ${item.dose}` : null,
    item.frequency ? (FREQUENCY_WORDS[item.frequency] ?? item.frequency) : null,
    item.durationDays ? `for ${item.durationDays} days` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(' ,', ',');
}

function mockSummary(raw: Record<string, unknown>, mode: 'ok' | 'unsafe'): SummaryOutput {
  const input = raw as unknown as SummaryInput;
  const who = [input.patient.ageYears === null ? null : `${input.patient.ageYears}-year-old`]
    .concat(input.patient.sex)
    .filter(Boolean)
    .join(' ');
  const complaint = input.chiefComplaint ?? 'no documented complaint';
  const diagnoses = input.diagnoses.map((d) => `Documented ${d.type} diagnosis: ${d.description}.`);
  const medications = (input.prescription?.items ?? []).map(medicationLine);
  const vitals = Object.entries(input.vitals).map(([k, v]) => `${k} ${v}`);
  const flags: string[] = [];
  if (input.patient.allergies.length === 0 && medications.length > 0) {
    flags.push('Allergy status not documented');
  }
  const out: SummaryOutput = {
    oneLineSummary: `${who} with ${complaint}.`.slice(0, 300),
    presentingComplaint: complaint,
    keyFindings: input.examination ? [input.examination.slice(0, 300)] : [],
    vitalsHighlights: vitals,
    assessment: diagnoses.length ? diagnoses.join(' ') : 'No diagnosis documented.',
    plan: input.plan ? [input.plan.slice(0, 300)] : [],
    medications,
    investigations: input.labTests.map((t) => `${t.name} (${t.status})`),
    followUp: input.followUp?.afterDays ? `Review after ${input.followUp.afterDays} days` : '',
    flagsForClinician: flags,
  };
  if (mode === 'unsafe') {
    // An invented diagnosis and an unprescribed medicine – the server checks must remove both.
    out.assessment = `${out.assessment} Documented final diagnosis: Community-acquired pneumonia.`;
    out.medications = [...out.medications, 'Azithromycin 500 mg, 1 tablet OD for 3 days'];
  }
  return out;
}

registerMockBuilder(SCHEMA_NAME, mockSummary);
