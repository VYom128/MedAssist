import type { FollowupType } from './api';

/** Plain-language request types (the patient's form and every list). */
export const FOLLOWUP_TYPE_LABELS: Record<FollowupType, { label: string; hint: string }> = {
  question: { label: 'A question', hint: 'About your treatment, medicines or advice' },
  new_or_worse_symptoms: {
    label: 'New or worse symptoms',
    hint: 'Something has changed since your visit',
  },
  report_review: { label: 'Review a report', hint: 'Ask the doctor to look at a report' },
  refill_request: { label: 'Medicine refill', hint: 'Your medicines are running out' },
  reschedule: { label: 'Change a visit', hint: 'Move or plan a follow-up visit' },
  other: { label: 'Something else', hint: 'Anything not listed above' },
};

export const EMERGENCY_NOTICE =
  'This is not for emergencies. If this is an emergency, call your local emergency number.';
