/**
 * Appointment seed plan (spec §15.3): ~300 appointments over the past 60 days and the next 14,
 * a live queue today, and upcoming bookings for patient1. A fixed faker seed keeps it
 * deterministic for a given clinic date.
 */

export const APPOINTMENT_FAKER_SEED = 20_260_925;
export const PAST_DAYS = 60;
export const FUTURE_DAYS = 14;
/** Past appointments (the rest of the ~300 are today's queues and upcoming bookings). */
export const PAST_TARGET = 245;
export const FUTURE_TARGET = 40;

/**
 * Past outcomes (cumulative thresholds): 75 % completed, 10 % cancelled, 6 % no-show, the rest
 * completed follow-ups of an earlier visit.
 */
export const PAST_OUTCOMES = { completed: 0.75, cancelled: 0.85, noShow: 0.91 } as const;

/** Patient-stated reasons per department (non-clinical wording, as a patient would say it). */
export const REASONS: Record<string, string[]> = {
  GEN: [
    'Fever for 3 days',
    'BP review',
    'Cough and cold',
    'Diabetes check-up',
    'Headache since yesterday',
    'Stomach ache',
    'Feeling tired all the time',
    'Routine health check-up',
    'Sore throat',
    'Body ache and chills',
  ],
  PED: [
    'Child has fever',
    'Vaccination query',
    'Cough for a week',
    'Not eating well',
    'Ear pain in child',
    'Loose motions',
    'Growth check-up',
    'Rash on arms',
  ],
  DER: [
    'Skin rash',
    'Acne',
    'Hair fall',
    'Itching on legs',
    'Dark patches on face',
    'Nail infection',
  ],
  ORT: [
    'Knee pain',
    'Lower back pain',
    'Shoulder stiffness',
    'Ankle sprain',
    'Neck pain',
    'Wrist pain after fall',
  ],
  ENT: [
    'Ear pain',
    'Blocked nose',
    'Sore throat for a week',
    'Ringing in ears',
    'Sinus trouble',
    'Hoarse voice',
  ],
};

export const FOLLOW_UP_REASONS = ['Follow-up visit', 'Review of reports', 'Check progress'];

export const CANCELLATION_REASONS = [
  'Patient called to cancel',
  'Travelling out of town',
  'Feeling better',
  'Clash with office work',
  'Booked by mistake',
];

/**
 * Today's live queue per doctor (the first doctors with a session today): how many completed,
 * with the doctor, waiting (one of them an emergency), walk-ins and bookings later today.
 */
export const TODAY_PLAN = [
  { completed: 3, inConsultation: 1, waiting: 4, walkIns: 1, laterToday: 3 },
  { completed: 2, inConsultation: 1, waiting: 3, walkIns: 0, laterToday: 2 },
  { completed: 1, inConsultation: 0, waiting: 2, walkIns: 0, laterToday: 2 },
] as const;
