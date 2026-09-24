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
