import { formatDate } from '../../utils/dates';
import type { ClinicalSummary } from './api';

/** "AI-assisted · reviewed by Dr X on 12 Oct 2026" – the label of every approved summary. */
export function reviewedLine(s: Pick<ClinicalSummary, 'reviewedBy' | 'reviewedAt'>) {
  const who = s.reviewedBy?.name ?? 'the doctor';
  return `AI-assisted · reviewed by ${who}${s.reviewedAt ? ` on ${formatDate(s.reviewedAt)}` : ''}`;
}

/** Why "Approve" is not available yet, in the order the doctor can fix them. */
export function approveBlockers(state: {
  scrolled: boolean;
  noteSigned: boolean;
  isOutdated: boolean;
  unsaved: boolean;
  empty: boolean;
}): string[] {
  const out: string[] = [];
  if (!state.scrolled) out.push('Read the whole draft – scroll to its end.');
  if (!state.noteSigned) {
    out.push('Sign the note first – only a signed note’s summary can be approved.');
  }
  if (state.isOutdated) out.push('The note changed after this draft – regenerate it first.');
  if (state.unsaved) out.push('Save your changes to the summary text.');
  if (state.empty) out.push('The summary text is empty.');
  return out;
}

/** Refused = an explicit "no" (given false with a date); never asked is not refused (server). */
export const aiConsentRefused = (c: { given: boolean; at: string | null } | undefined) =>
  Boolean(c && !c.given && c.at);
