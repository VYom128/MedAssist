/**
 * What the server's checks did to an AI answer, in plain words (server AI_GUARDRAIL_FLAGS).
 * Unknown flags fall back to the flag name with spaces.
 */
const FLAG_TEXT: Record<string, string> = {
  unverified_diagnosis_removed: 'An unverified diagnosis was removed (it was not in the note).',
  unverified_medication_removed: 'A medicine that is not in the prescription was removed.',
  output_retried: 'The first AI answer was unusable, so it was asked again.',
  fallback_model: 'A backup AI model wrote this draft.',
  medicine_not_prescribed: 'The AI named a medicine that was not prescribed.',
  medicine_missing: 'The AI left out a prescribed medicine.',
  number_mismatch: 'A dose, frequency or duration did not match the prescription.',
  forbidden_phrase: 'The AI used wording that sounds like a diagnosis or a treatment change.',
  regenerated: 'The first answer failed the safety checks and was written again.',
  fallback_template: 'The simple template was used instead of the AI answer.',
  ai_unavailable: 'The AI was not available.',
  ai_output_invalid: 'The AI answer was not in the expected format.',
  daily_limit: 'The daily AI limit was reached.',
};

export const flagText = (flag: string) => FLAG_TEXT[flag] ?? flag.replace(/_/g, ' ');

/** Short labels for tables (admin monitor). */
const FLAG_LABEL: Record<string, string> = {
  unverified_diagnosis_removed: 'Diagnosis removed',
  unverified_medication_removed: 'Medicine removed',
  output_retried: 'Retried',
  fallback_model: 'Fallback model',
  medicine_not_prescribed: 'Invented medicine',
  medicine_missing: 'Missing medicine',
  number_mismatch: 'Number mismatch',
  forbidden_phrase: 'Forbidden phrase',
  regenerated: 'Regenerated',
  fallback_template: 'Template',
  ai_unavailable: 'Unavailable',
  ai_output_invalid: 'Invalid output',
  daily_limit: 'Daily limit',
};

export const flagLabel = (flag: string) => FLAG_LABEL[flag] ?? flag.replace(/_/g, ' ');
