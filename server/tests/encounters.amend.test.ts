import { Appointment } from '../src/modules/appointments/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  insertAppointment,
  loginAsDoctor,
  readyToSign,
  signNote,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** Amendments of signed notes (spec §5.2, §6.14, §8.5). */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    NoteAmendment.init(),
  ]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const amend = (who: LoggedIn, id: string, body: object) =>
  api().post(`/api/v1/encounters/${id}/amendments`).set(who.auth).send(body);
const history = (who: LoggedIn, id: string) =>
  api().get(`/api/v1/encounters/${id}/amendments`).set(who.auth);

async function signedNote() {
  const c = await readyToSign({ items: [] });
  await signNote(c.doctor, c.encounterId);
  return c;
}

describe('POST /encounters/:id/amendments', () => {
  it('each amendment creates a version with the reason and before/after of the changed fields', async () => {
    const c = await signedNote();
    const first = await amend(c.doctor, c.encounterId, {
      reason: 'Temperature was entered in the wrong field',
      changes: {
        vitals: { temperatureC: 37.9 },
        assessment: 'Viral pharyngitis likely',
        chiefComplaint: 'Fever and sore throat for 3 days', // unchanged → not listed
      },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data).toMatchObject({
      status: 'amended',
      version: 2,
      assessment: 'Viral pharyngitis likely',
      lastAmendedAt: expect.any(String),
    });
    expect(first.body.data.vitals).toMatchObject({ temperatureC: 37.9, pulse: 96 });

    const second = await amend(c.doctor, c.encounterId, {
      reason: 'Added the ICD-10 code for the second diagnosis',
      changes: {
        diagnoses: [
          { description: 'Acute pharyngitis', icd10Code: 'J02.9', isPrimary: true },
          { description: 'Fever', icd10Code: 'R50.9' },
        ],
      },
    });
    expect(second.body.data).toMatchObject({ status: 'amended', version: 3 });

    const stored = await NoteAmendment.find({ encounter: c.encounterId })
      .sort({ version: 1 })
      .lean();
    expect(stored.map((a) => a.version)).toEqual([2, 3]);
    expect(stored[0]).toMatchObject({
      reason: 'Temperature was entered in the wrong field',
      changedFields: ['vitals', 'assessment'],
      before: { vitals: { temperatureC: 38.4, pulse: 96 }, assessment: null },
      after: { vitals: { temperatureC: 37.9, pulse: 96 }, assessment: 'Viral pharyngitis likely' },
    });
    expect(stored[0]?.amendedBy.toString()).toBe(c.doctor.id);
    expect(stored[1]?.changedFields).toEqual(['diagnoses']);
    expect((stored[1]?.before as { diagnoses: unknown[] }).diagnoses).toHaveLength(1);
  });

  it('GET /encounters/:id/amendments returns the history, oldest first', async () => {
    const c = await signedNote();
    await amend(c.doctor, c.encounterId, {
      reason: 'Corrected the plan after the lab call',
      changes: { plan: 'Review in 3 days' },
    });
    const res = await history(c.doctor, c.encounterId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ currentVersion: 2, signedAt: expect.any(String) });
    expect(res.body.data.amendments).toEqual([
      expect.objectContaining({
        version: 2,
        reason: 'Corrected the plan after the lab call',
        changedFields: ['plan'],
        before: { plan: null },
        after: { plan: 'Review in 3 days' },
        amendedBy: { id: c.doctor.id, name: expect.any(String) },
      }),
    ]);

    // A doctor with a care relationship reads it; one without gets 404.
    const related = await loginAsDoctor();
    await insertAppointment({
      patient: c.patientId,
      doctor: related.id,
      startAt: new Date(Date.now() - 40 * 86_400_000),
      status: 'completed',
      isSlotActive: false,
    });
    expect((await history(related, c.encounterId)).status).toBe(200);
    expect((await history(await loginAsDoctor(), c.encounterId)).status).toBe(404);
    expect((await history(await loginAs('receptionist'), c.encounterId)).status).toBe(403);
  });

  it('the reason needs at least 10 characters; changes must change something', async () => {
    const c = await signedNote();
    const short = await amend(c.doctor, c.encounterId, {
      reason: 'typo',
      changes: { plan: 'x' },
    });
    expect(expectErrorShape(short.body, 'VALIDATION_ERROR').error.details).toEqual([
      expect.objectContaining({ field: 'body.reason' }),
    ]);
    const empty = await amend(c.doctor, c.encounterId, {
      reason: 'Nothing at all here',
      changes: {},
    });
    expectErrorShape(empty.body, 'VALIDATION_ERROR');
    const same = await amend(c.doctor, c.encounterId, {
      reason: 'Same text again, no change',
      changes: { chiefComplaint: 'Fever and sore throat for 3 days' },
    });
    expect(same.status).toBe(422);
    const prescription = await amend(c.doctor, c.encounterId, {
      reason: 'Trying to change the drugs here',
      changes: { items: [] },
    });
    expectErrorShape(prescription.body, 'VALIDATION_ERROR');
    expect(await NoteAmendment.countDocuments()).toBe(0);
  });

  it('drafts cannot be amended (409); only the note’s doctor may amend (404)', async () => {
    const draft = await startedConsultation();
    const res = await amend(draft.doctor, draft.encounterId, {
      reason: 'Amending a draft is not possible',
      changes: { plan: 'x' },
    });
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'INVALID_STATUS_TRANSITION');

    const c = await signedNote();
    const other = await loginAsDoctor();
    const denied = await amend(other, c.encounterId, {
      reason: 'Someone else trying to amend',
      changes: { plan: 'x' },
    });
    expect(denied.status).toBe(404);
  });

  it('audits field names only – no values, no reason text', async () => {
    const c = await signedNote();
    await amend(c.doctor, c.encounterId, {
      reason: 'Patient disclosed smoking history later',
      changes: { pastHistory: 'Smoker, 10 pack-years' },
    });
    const [entry] = await auditEntries('encounter.amend');
    expect(entry?.changes?.fields).toEqual(['pastHistory']);
    expect(entry?.metadata).toMatchObject({ version: 2 });
    expect(JSON.stringify(entry)).not.toMatch(/Smoker|pack|smoking/i);
  });

  it('two amendments at the same moment: one wins, versions stay unique', async () => {
    const c = await signedNote();
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        amend(c.doctor, c.encounterId, {
          reason: `Parallel amendment number ${n}`,
          changes: { plan: `Plan ${n}` },
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const versions = (await NoteAmendment.find({ encounter: c.encounterId }).lean()).map(
      (a) => a.version,
    );
    expect(new Set(versions).size).toBe(versions.length);
    expect((await Encounter.findById(c.encounterId).lean())?.version).toBe(1 + versions.length);
  });
});

describe('note_amendments is append-only', () => {
  it('updates and deletes throw RECORD_LOCKED', async () => {
    const c = await signedNote();
    await amend(c.doctor, c.encounterId, {
      reason: 'A real amendment to lock',
      changes: { plan: 'Rest' },
    });
    const locked = { statusCode: 409, code: 'RECORD_LOCKED' };
    await expect(
      NoteAmendment.updateOne({}, { $set: { reason: 'Rewritten history' } }),
    ).rejects.toMatchObject(locked);
    await expect(NoteAmendment.deleteMany({})).rejects.toMatchObject(locked);
    const doc = (await NoteAmendment.findOne())!;
    doc.reason = 'Rewritten history';
    await expect(doc.save()).rejects.toMatchObject(locked);
    await expect(doc.deleteOne()).rejects.toMatchObject(locked);
    expect(await NoteAmendment.countDocuments()).toBe(1);
  });
});
