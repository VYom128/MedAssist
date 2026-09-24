import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { runSeed } from '../src/seed/index.js';
import { checkAllergies } from '../src/services/allergyCheck.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';

/** Clinical notes and prescriptions in the seed (spec §15.3). */

describe('encounter seed', () => {
  let summary: Awaited<ReturnType<typeof runSeed>>;
  let emails: ReturnType<typeof captureEmails>;

  beforeAll(async () => {
    await Promise.all([
      DoctorProfile.init(),
      DoctorSchedule.init(),
      Appointment.init(),
      Encounter.init(),
      Prescription.init(),
      NoteAmendment.init(),
    ]);
    await resetDb();
    emails = captureEmails();
    summary = await runSeed();
  }, 180_000);
  afterAll(() => emails.restore());

  it('signs a note for every completed appointment', async () => {
    const completed = await Appointment.find({ status: 'completed' }).select('_id').lean();
    const notes = await Encounter.find({
      appointment: { $in: completed.map((a) => a._id) },
    }).lean();
    expect(notes).toHaveLength(completed.length);
    expect(notes.every((n) => n.status === 'signed' || n.status === 'amended')).toBe(true);
    expect(notes.every((n) => n.chiefComplaint && n.diagnoses.length > 0 && n.signedAt)).toBe(true);
    expect(notes.every((n) => (n.vitals?.bmi ?? 0) > 0)).toBe(true);
    expect(summary.encounters).toMatchObject({ created: completed.length, unchanged: 0 });
  });

  it('issues prescriptions for most notes and plans follow-ups on some', async () => {
    const notes = await Encounter.countDocuments({ status: { $ne: 'draft' } });
    const issued = await Prescription.countDocuments({ status: 'issued' });
    expect(issued / notes).toBeGreaterThan(0.7);
    expect(issued / notes).toBeLessThan(0.95);
    const followUps = await Encounter.countDocuments({ 'followUp.required': true });
    expect(followUps / notes).toBeGreaterThan(0.25);
    expect(followUps / notes).toBeLessThan(0.6);
    const numbers = await Prescription.distinct('prescriptionNumber');
    expect(numbers).toHaveLength(issued);
  });

  it('never prescribes a drug the patient is allergic to, except the acknowledged demo', async () => {
    const rxs = await Prescription.find().lean();
    const patients = new Map(
      (await Patient.find().select('allergies').lean()).map((p) => [p._id.toString(), p]),
    );
    let acknowledged = 0;
    for (const rx of rxs) {
      const allergies = patients.get(rx.patient.toString())?.allergies ?? [];
      const matches = checkAllergies(rx.items, allergies);
      rx.items.forEach((item, i) => {
        if (!matches[i]) return;
        expect(
          item.allergyWarning?.acknowledgedAt,
          `${rx.prescriptionNumber} ${item.drugName}`,
        ).toBeTruthy();
        acknowledged += 1;
      });
    }
    expect(acknowledged).toBe(1);
    expect(summary.encounters).toMatchObject({ acknowledgedWarnings: 1 });
  });

  it('amends three notes with reasons; drafts for today’s consultations', async () => {
    const amended = await Encounter.find({ status: 'amended' }).lean();
    expect(amended).toHaveLength(3);
    expect(amended.every((e) => e.version === 2)).toBe(true);
    const entries = await NoteAmendment.find().lean();
    expect(entries).toHaveLength(3);
    expect(entries.every((a) => a.reason.length >= 10 && a.changedFields.length > 0)).toBe(true);

    const underWay = await Appointment.find({ status: 'in_consultation' }).select('_id').lean();
    const drafts = await Encounter.find({
      appointment: { $in: underWay.map((a) => a._id) },
    }).lean();
    expect(drafts).toHaveLength(underWay.length);
    expect(drafts.every((d) => d.status === 'draft' && d.chiefComplaint)).toBe(true);
  });

  it('a second run changes nothing', async () => {
    const before = {
      notes: await Encounter.countDocuments(),
      rx: await Prescription.countDocuments(),
      amendments: await NoteAmendment.countDocuments(),
    };
    const again = await runSeed();
    expect(again.encounters).toMatchObject({ created: 0, amended: 3, todayDrafts: 0 });
    expect({
      notes: await Encounter.countDocuments(),
      rx: await Prescription.countDocuments(),
      amendments: await NoteAmendment.countDocuments(),
    }).toEqual(before);
  }, 120_000);
});
