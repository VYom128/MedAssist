import { DRUG_TIMING_LABELS } from '../../constants/catalog';
import type { PrescriptionItem } from './api';

/** "1 tablet · Three times a day · After food · 5 days" */
export function itemLine(i: PrescriptionItem) {
  return [
    i.dose,
    i.frequencyLabel,
    i.timing ? DRUG_TIMING_LABELS[i.timing] : null,
    i.durationDays ? `${i.durationDays} day${i.durationDays === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * An item in plain words for patients: "1 tablet, twice a day, after food, for 5 days" (the
 * frequency label comes from the server; `other` uses the doctor's text).
 */
export function plainItem(i: PrescriptionItem) {
  return [
    i.dose,
    i.frequencyLabel ? lower(i.frequencyLabel) : null,
    i.timing && i.timing !== 'any' ? lower(DRUG_TIMING_LABELS[i.timing]) : null,
    i.durationDays ? `for ${i.durationDays} day${i.durationDays === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}
