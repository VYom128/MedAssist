import type { Types } from 'mongoose';
import { assertAiEnabled } from '../ai/guards.js';
import { ERROR_CODES, type ExplanationLanguage } from '../config/constants.js';
import { Patient } from '../modules/patients/model.js';
import { getSettings } from '../modules/settings/service.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Who may get an AI explanation (spec §9.3), after the caller passed the source's own read
 * policy (prescription / encounter): AI and patient explanations on in settings, the language
 * enabled, and the patient has not refused AI explanations. Any of these → 403 AI_DISABLED.
 * Applies to doctor previews too (the patient's data would still go to the AI provider).
 */

interface ConsentFields {
  consent?: { aiExplanations?: { given?: boolean | null; at?: Date | null } | null } | null;
}

/** Refused = an explicit "no" (given false with a date); never asked counts as not refused. */
export function aiConsentRefused(p: ConsentFields | null): boolean {
  const c = p?.consent?.aiExplanations;
  return Boolean(c && c.given === false && c.at);
}

export async function assertExplanationAllowed(
  patientId: Types.ObjectId | string,
  language: ExplanationLanguage,
): Promise<void> {
  await assertAiEnabled('patient_explanation');
  const { ai } = await getSettings();
  if (!(ai?.explanationLanguages ?? []).includes(language)) {
    throw new ApiError(
      403,
      'Explanations in this language are turned off',
      ERROR_CODES.AI_DISABLED,
      { language },
    );
  }
  const patient = await Patient.findById(patientId).select('consent').lean<ConsentFields>();
  if (aiConsentRefused(patient)) {
    throw new ApiError(
      403,
      'AI explanations are turned off for this patient',
      ERROR_CODES.AI_DISABLED,
      { reason: 'consent' },
    );
  }
}
