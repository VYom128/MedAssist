import { DRUG_FREQUENCIES } from '../../config/constants.js';
import type { FormularyDrug } from '../../data/formulary.js';

/** One autocomplete suggestion. */
export function toSuggestion(d: FormularyDrug) {
  return {
    name: d.name,
    genericName: d.genericName,
    strengths: [...d.strengths],
    forms: [...d.forms],
    route: d.route,
    doseHint: d.doseHint ?? null,
    frequencyHint: d.frequencyHint ?? null,
    frequencyHintLabel: d.frequencyHint ? DRUG_FREQUENCIES[d.frequencyHint] : null,
  };
}
