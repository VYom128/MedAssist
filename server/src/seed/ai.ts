import type { Types } from 'mongoose';
import { forceMockProvider } from '../ai/providers/index.js';
import { ROLES } from '../config/constants.js';
import { Encounter } from '../modules/encounters/model.js';
import { PatientExplanation } from '../modules/explanations/model.js';
import { explainFollowUp, explainPrescription } from '../modules/explanations/service.js';
import { Prescription } from '../modules/prescriptions/model.js';
import { ClinicalSummary } from '../modules/summaries/model.js';
import { approveSummary, generateSummary } from '../modules/summaries/service.js';
import { User } from '../modules/users/model.js';
import { ISSUED_STATUSES } from '../policies/prescriptionAccess.js';
import { SEED_REQUEST } from './context.js';
import { patientActor } from './documents.js';
import { doctorActor } from './encounters.js';
import { patientLogins } from './patients.js';

/**
 * AI demo data (Phase 9), after the notes and follow-ups, through the real services with the
 * MOCK provider (forced – the seed never calls a real AI provider, whatever AI_PROVIDER says):
 * - approved clinical summaries of the latest signed note of three portal patients; patient1's
 *   is shared with the patient (it shows on their timeline);
 * - cached explanations for patient1: the latest issued prescription in English and Hindi, and
 *   the follow-up plan of the latest note that has one (English).
 * Idempotent: a note that already has an approved summary is skipped, and so is an explanation
 * already cached (without reading it, so a second run writes no audit entries). `--reset` clears summaries, explanations and ai_interactions.
 */

const SUMMARY_PATIENTS = 3;

export async function seedAi(): Promise<Record<string, number>> {
  forceMockProvider();
  const result = { summaries: 0, shared: 0, explanations: 0, unchanged: 0 };

  const emails = patientLogins()
    .filter((l) => l.role === ROLES.PATIENT)
    .slice(0, SUMMARY_PATIENTS)
    .map((l) => l.email);
  const users = await User.find({ email: { $in: emails } })
    .select('email patient')
    .lean();
  const patientOf = new Map(users.map((u) => [u.email, u.patient as Types.ObjectId | undefined]));

  for (const [i, email] of emails.entries()) {
    const patient = patientOf.get(email);
    if (!patient) continue;
    const note = await Encounter.findOne({ patient, status: { $in: ['signed', 'amended'] } })
      .sort({ signedAt: -1, _id: -1 })
      .select('_id doctor')
      .lean();
    if (!note) continue;
    if (await ClinicalSummary.exists({ encounter: note._id, status: 'approved' })) {
      result.unchanged += 1;
      continue;
    }
    const doctor = await doctorActor(note.doctor);
    const draft = await generateSummary(doctor, note._id.toString(), SEED_REQUEST);
    const share = i === 0; // patient1
    await approveSummary(
      doctor,
      note._id.toString(),
      draft.id,
      { shareWithPatient: share },
      SEED_REQUEST,
    );
    result.summaries += 1;
    if (share) result.shared += 1;
  }

  // patient1's explanations (cached, so the portal shows them at once).
  const patient1 = await patientActor('patient1@medassist.dev');
  // Already cached → skip without reading it (a read would add an explanation.view audit entry).
  const explainOnce = async (
    sourceType: 'prescription' | 'follow_up_plan',
    sourceId: Types.ObjectId,
    language: 'en' | 'hi',
    explain: () => Promise<{ fromCache: boolean }>,
  ) => {
    if (await PatientExplanation.exists({ sourceType, sourceId, language, cached: true })) {
      result.unchanged += 1;
      return;
    }
    if ((await explain()).fromCache) result.unchanged += 1;
    else result.explanations += 1;
  };
  const rx = await Prescription.findOne({
    patient: patient1.patientId,
    status: { $in: ISSUED_STATUSES },
  })
    .sort({ issuedAt: -1, _id: -1 })
    .select('_id')
    .lean();
  if (rx) {
    for (const language of ['en', 'hi'] as const) {
      await explainOnce('prescription', rx._id, language, () =>
        explainPrescription(patient1, rx._id.toString(), { language }, SEED_REQUEST),
      );
    }
  }
  const planned = await Encounter.findOne({
    patient: patient1.patientId,
    status: { $in: ['signed', 'amended'] },
    'followUp.required': true,
  })
    .sort({ signedAt: -1, _id: -1 })
    .select('_id')
    .lean();
  if (planned) {
    await explainOnce('follow_up_plan', planned._id, 'en', () =>
      explainFollowUp(patient1, planned._id.toString(), { language: 'en' }, SEED_REQUEST),
    );
  }
  return result;
}
