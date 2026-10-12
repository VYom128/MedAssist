import { AiInteraction } from '../src/modules/aiInteractions/model.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { PatientExplanation } from '../src/modules/explanations/model.js';
import { FollowupReminder } from '../src/modules/followupReminders/model.js';
import { FollowupRequest } from '../src/modules/followups/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { User } from '../src/modules/users/model.js';
import { runSeed } from '../src/seed/index.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';

/** AI demo data in the seed (Phase 9): through the services, mock provider only, idempotent. */

describe('AI seed', () => {
  let emails: ReturnType<typeof captureEmails>;

  beforeAll(async () => {
    await Promise.all([
      DoctorProfile.init(),
      DoctorSchedule.init(),
      Appointment.init(),
      Encounter.init(),
      Prescription.init(),
      NoteAmendment.init(),
      FollowupRequest.init(),
      FollowupReminder.init(),
      ClinicalSummary.init(),
      PatientExplanation.init(),
    ]);
    await resetDb();
    emails = captureEmails();
    await runSeed();
  }, 180_000);
  afterAll(() => emails.restore());

  it('approves three summaries – patient1’s shared – and caches patient1’s explanations', async () => {
    const approved = await ClinicalSummary.find({ status: 'approved' }).lean();
    expect(approved).toHaveLength(3);
    expect(approved.filter((s) => s.shareWithPatient)).toHaveLength(1);
    const patient1 = await User.findOne({ email: 'patient1@medassist.dev' }).lean();
    const shared = approved.find((s) => s.shareWithPatient)!;
    expect(shared.patient.toString()).toBe(patient1!.patient!.toString());

    const cached = await PatientExplanation.find({ cached: true }).lean();
    expect(cached.map((x) => [x.sourceType, x.language]).sort()).toEqual([
      ['follow_up_plan', 'en'],
      ['prescription', 'en'],
      ['prescription', 'hi'],
    ]);
    expect(cached.every((x) => x.patient.toString() === patient1!.patient!.toString())).toBe(true);
    expect(cached.every((x) => !x.isFallback && x.disclaimer)).toBe(true);
  });

  it('only ever used the mock provider', async () => {
    const providers = await AiInteraction.distinct('provider');
    expect(providers).toEqual(['mock']);
  });

  it('changes nothing when run again', async () => {
    const before = await AiInteraction.countDocuments();
    const summary = await runSeed();
    expect(summary.ai).toEqual({ summaries: 0, shared: 0, explanations: 0, unchanged: 6 });
    expect(await AiInteraction.countDocuments()).toBe(before);
    expect(await ClinicalSummary.countDocuments({ status: 'approved' })).toBe(3);
  }, 180_000);
});
