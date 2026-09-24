import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createPatient,
  insertAppointment,
  loginAsDoctor,
  putPrescription,
  readyToSign,
  rxItem,
  signNote,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** Prescriptions (spec §5.3, §6.16, §7.12, §8.6). */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init()]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const get = (path: string, who: LoggedIn) => api().get(`/api/v1${path}`).set(who.auth);
const post = (path: string, who: LoggedIn, body: object = {}) =>
  api().post(`/api/v1${path}`).set(who.auth).send(body);

/** A patient user linked to `patientId`. */
async function patientLogin(patientId: string) {
  const me = await loginAs('patient', { patient: patientId, patientLinkStatus: 'linked' });
  return me;
}

/** A signed note with an issued prescription. */
async function issued(options: Parameters<typeof readyToSign>[0] = {}) {
  const c = await readyToSign(options);
  await signNote(c.doctor, c.encounterId);
  return { ...c, prescriptionId: c.prescriptionId! };
}

const relate = (doctorId: string, patientId: string) =>
  insertAppointment({
    patient: patientId,
    doctor: doctorId,
    startAt: new Date(Date.now() - 30 * 86_400_000 + Math.floor(Math.random() * 1e6)),
    status: 'completed',
    isSlotActive: false,
  });

describe('PUT /encounters/:id/prescription (draft)', () => {
  it('creates the draft, then replaces it with the current revision', async () => {
    const c = await startedConsultation();
    const created = await putPrescription(c.doctor, c.encounterId, {
      items: [rxItem(), { drugName: 'Cetirizine' }],
      generalInstructions: 'Drink plenty of fluids',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.data).toMatchObject({
      status: 'draft',
      prescriptionNumber: null,
      isCurrent: true,
      revision: 0,
      generalInstructions: 'Drink plenty of fluids',
      allergyWarnings: [],
    });
    expect(created.body.data.items[0]).toMatchObject({
      drugName: 'Paracetamol',
      frequency: 'TDS',
      frequencyLabel: 'Three times a day',
      durationDays: 5,
      allergyWarning: null,
    });
    expect(created.body.data.items[1]).toMatchObject({ drugName: 'Cetirizine', dose: null });

    const stale = await putPrescription(c.doctor, c.encounterId, { items: [] });
    expect(stale.status).toBe(409);
    expect(expectErrorShape(stale.body, 'CONFLICT').error.details).toEqual({ currentRevision: 0 });

    const replaced = await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: 0,
      items: [rxItem({ drugName: 'Ibuprofen', genericName: 'Ibuprofen' })],
      generalInstructions: '',
    });
    expect(replaced.body.data).toMatchObject({ revision: 1, generalInstructions: null });
    expect(replaced.body.data.items).toHaveLength(1);
    expect(await Prescription.countDocuments({ encounter: c.encounterId })).toBe(1);
  });

  it('parallel first saves → one draft (the others get 409)', async () => {
    const c = await startedConsultation();
    const results = await Promise.all(
      [1, 2, 3].map(() => putPrescription(c.doctor, c.encounterId, { items: [rxItem()] })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await Prescription.countDocuments({ encounter: c.encounterId, isCurrent: true })).toBe(
      1,
    );
  });

  it('validates items', async () => {
    const c = await startedConsultation();
    const cases: [Record<string, unknown>, string][] = [
      [{ items: [{ dose: '1 tablet' }] }, 'body.items.0.drugName'],
      [{ items: [rxItem({ frequency: 'other' })] }, 'body.items.0.frequencyText'],
      [{ items: [rxItem({ durationDays: 0 })] }, 'body.items.0.durationDays'],
      [{ items: [rxItem({ durationDays: 366 })] }, 'body.items.0.durationDays'],
      [{ items: [rxItem({ frequency: 'hourly' })] }, 'body.items.0.frequency'],
      [{ items: [rxItem({ route: 'rectal' })] }, 'body.items.0.route'],
      [{ items: [rxItem({ instructions: 'x'.repeat(301) })] }, 'body.items.0.instructions'],
      [{ items: [rxItem({ allergyWarning: { substance: 'x' } })] }, 'body.items.0'],
      [{ items: Array.from({ length: 31 }, () => rxItem()) }, 'body.items'],
      [{}, 'body.items'],
    ];
    for (const [body, field] of cases) {
      const res = await putPrescription(c.doctor, c.encounterId, body);
      expect(res.status, field).toBe(400);
      expect(expectErrorShape(res.body, 'VALIDATION_ERROR').error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    }
  });

  it('keeps an acknowledgement across saves of the same drug; a new drug or false resets it', async () => {
    const { id: patientId } = await createPatient({
      allergies: [{ substance: 'Sulfa', severity: 'moderate' }],
    });
    const c = await startedConsultation(undefined, { patientId });
    const drug = rxItem({
      drugName: 'Co-trimoxazole DS',
      genericName: 'Sulfamethoxazole + Trimethoprim',
    });
    const a = await putPrescription(c.doctor, c.encounterId, {
      items: [{ ...drug, acknowledgeAllergy: true }],
    });
    expect(a.body.data.allergyWarnings).toEqual([
      expect.objectContaining({
        substance: 'Sulfa',
        drugClass: 'Sulfonamides',
        acknowledged: true,
      }),
    ]);
    const firstAck = a.body.data.items[0].allergyWarning.acknowledgedAt;

    // Autosave without the flag, dose changed: still acknowledged (same drug, same allergy).
    const b = await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: 0,
      items: [{ ...drug, dose: '2 tablets' }],
    });
    expect(b.body.data.items[0].allergyWarning).toMatchObject({
      acknowledged: true,
      acknowledgedAt: firstAck,
    });
    // Withdrawn explicitly.
    const d = await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: 1,
      items: [{ ...drug, acknowledgeAllergy: false }],
    });
    expect(d.body.data.items[0].allergyWarning.acknowledged).toBe(false);
    // A different drug of the class needs its own acknowledgement.
    await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: 2,
      items: [{ ...drug, acknowledgeAllergy: true }],
    });
    const e = await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: 3,
      items: [rxItem({ drugName: 'Sulfasalazine', genericName: 'Sulfasalazine' })],
    });
    expect(e.body.data.items[0].allergyWarning).toMatchObject({
      substance: 'Sulfa',
      acknowledged: false,
    });
  });

  it('audits counts only (no drug names), debounced', async () => {
    const { id: patientId } = await createPatient({
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
    });
    const c = await startedConsultation(undefined, { patientId });
    await putPrescription(c.doctor, c.encounterId, {
      items: [rxItem({ drugName: 'Amoxicillin', acknowledgeAllergy: true }), rxItem()],
    });
    await putPrescription(c.doctor, c.encounterId, { expectedVersion: 0, items: [rxItem()] });
    const entries = await auditEntries('prescription.update');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toEqual({
      itemCount: 2,
      allergyWarnings: 1,
      allergyWarningsAcknowledged: 1,
    });
    expect(JSON.stringify(entries)).not.toMatch(/amoxicillin|paracetamol|penicillin/i);
  });

  it('another doctor → 404; after the documentation window → 422; staff → 403', async () => {
    const c = await startedConsultation();
    const other = await loginAsDoctor();
    await relate(other.id, c.patientId);
    expect((await putPrescription(other, c.encounterId, { items: [] })).status).toBe(404);
    await Appointment.updateOne(
      { _id: c.appointmentId },
      {
        $set: {
          status: 'completed',
          isSlotActive: true,
          'queue.completedAt': new Date(Date.now() - 80 * 3_600_000),
        },
      },
    );
    const late = await putPrescription(c.doctor, c.encounterId, { items: [rxItem()] });
    expect(late.status).toBe(422);
    expectErrorShape(late.body, 'DOCUMENTATION_WINDOW_CLOSED');
    expect(
      (await putPrescription(await loginAs('receptionist'), c.encounterId, { items: [] })).status,
    ).toBe(403);
  });
});

describe('reading prescriptions', () => {
  it('each role sees what it may (doctor, other doctors, patient, reception)', async () => {
    const { id: patientId } = await createPatient({
      allergies: [{ substance: 'NSAIDs', severity: 'mild' }],
    });
    const c = await issued({
      patientId,
      items: [
        rxItem({ drugName: 'Ibuprofen', genericName: 'Ibuprofen', acknowledgeAllergy: true }),
      ],
    });
    const owner = await get(`/prescriptions/${c.prescriptionId}`, c.doctor);
    expect(owner.body.data).toMatchObject({ status: 'issued', isCurrent: true });
    expect(owner.body.data.items[0].allergyWarning).toMatchObject({ acknowledged: true });

    const related = await loginAsDoctor();
    await relate(related.id, patientId);
    expect((await get(`/prescriptions/${c.prescriptionId}`, related)).status).toBe(200);
    expect((await get(`/prescriptions/${c.prescriptionId}`, await loginAsDoctor())).status).toBe(
      404,
    );

    const patient = await patientLogin(patientId);
    const own = await get(`/prescriptions/${c.prescriptionId}`, patient);
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({
      status: 'issued',
      prescriptionNumber: expect.any(String),
    });
    expect(JSON.stringify(own.body.data)).not.toMatch(/allergy|isCurrent|revision|acknowledged/i);

    const reception = await get(
      `/prescriptions/${c.prescriptionId}`,
      await loginAs('receptionist'),
    );
    expect(reception.status).toBe(200);
    expect(reception.body.data.patient).toMatchObject({ id: patientId, mrn: expect.any(String) });
    expect(reception.body.data.items[0]).toMatchObject({
      drugName: 'Ibuprofen',
      frequencyLabel: 'Three times a day',
    });
    expect(JSON.stringify(reception.body.data)).not.toMatch(/allergy|acknowledged|NSAIDs/i);

    for (const role of ['admin', 'labtech'] as const) {
      expect((await get(`/prescriptions/${c.prescriptionId}`, await loginAs(role))).status).toBe(
        403,
      );
    }
    // One debounced view entry per user.
    await get(`/prescriptions/${c.prescriptionId}`, patient);
    const views = await auditEntries('prescription.view');
    expect(
      views.filter((v) => v.actor?.user?.toString() === patient.user._id.toString()),
    ).toHaveLength(1);
  });

  it('drafts are the doctor’s only: patients, reception and other doctors get 404', async () => {
    const c = await readyToSign();
    const related = await loginAsDoctor();
    await relate(related.id, c.patientId);
    const patient = await patientLogin(c.patientId);
    for (const who of [related, patient, await loginAs('receptionist')]) {
      expect((await get(`/prescriptions/${c.prescriptionId}`, who)).status).toBe(404);
    }
    expect(await auditEntries('access.denied')).toHaveLength(3);
  });

  it("a patient gets 404 on someone else's prescription; a pending sign-up 403", async () => {
    const c = await issued();
    const stranger = await patientLogin((await createPatient()).id);
    expect((await get(`/prescriptions/${c.prescriptionId}`, stranger)).status).toBe(404);
    const pending = await loginAs('patient', { patientLinkStatus: 'pending_verification' });
    const blocked = await get(`/prescriptions/${c.prescriptionId}`, pending);
    expectErrorShape(blocked.body, 'PATIENT_LINK_PENDING');
  });

  it('GET /prescriptions is scoped per role', async () => {
    const a = await issued();
    const draft = await readyToSign({ doctor: a.doctor, patientId: a.patientId });
    const other = await issued(); // another doctor and patient

    const doctorList = await get('/prescriptions', a.doctor);
    expect(doctorList.body.data.map((p: { id: string }) => p.id).sort()).toEqual(
      [a.prescriptionId, draft.prescriptionId].sort(),
    );
    expect(doctorList.body.data[0]).not.toHaveProperty('items');

    const patient = await patientLogin(a.patientId);
    const mine = await get('/prescriptions', patient);
    expect(mine.body.data.map((p: { id: string }) => p.id)).toEqual([a.prescriptionId]);
    expect(mine.body.data[0]).not.toHaveProperty('patient');
    // Asking for another patient's prescriptions returns nothing.
    const sneaky = await get(`/prescriptions?patient=${other.patientId}`, patient);
    expect(sneaky.body.data).toEqual([]);

    const reception = await loginAs('receptionist');
    expectErrorShape((await get('/prescriptions', reception)).body, 'VALIDATION_ERROR');
    const forPrinting = await get(`/prescriptions?patient=${a.patientId}`, reception);
    expect(forPrinting.body.data.map((p: { id: string }) => p.id)).toEqual([a.prescriptionId]);
    const byAppointment = await get(`/prescriptions?appointment=${other.appointmentId}`, reception);
    expect(byAppointment.body.data.map((p: { id: string }) => p.id)).toEqual([
      other.prescriptionId,
    ]);
    expect((await get('/prescriptions', await loginAs('admin'))).status).toBe(403);
  });
});

describe('cancel, reissue and issue', () => {
  it('cancel: issued → cancelled with a reason; not current any more', async () => {
    const c = await issued();
    const short = await post(`/prescriptions/${c.prescriptionId}/cancel`, c.doctor, {
      reason: 'no',
    });
    expectErrorShape(short.body, 'VALIDATION_ERROR');
    const res = await post(`/prescriptions/${c.prescriptionId}/cancel`, c.doctor, {
      reason: 'Patient reported a rash',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'cancelled',
      isCurrent: false,
      cancellation: { by: c.doctor.id, reason: 'Patient reported a rash', at: expect.any(String) },
    });
    const again = await post(`/prescriptions/${c.prescriptionId}/cancel`, c.doctor, {
      reason: 'Patient reported a rash',
    });
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');
    const [entry] = await auditEntries('prescription.cancel');
    expect(JSON.stringify(entry)).not.toMatch(/rash/);
    // The patient no longer sees it.
    const patient = await patientLogin(c.patientId);
    expect((await get(`/prescriptions/${c.prescriptionId}`, patient)).status).toBe(404);
  });

  it('a draft cannot be cancelled; others cannot cancel (404); staff 403', async () => {
    const c = await readyToSign();
    const draft = await post(`/prescriptions/${c.prescriptionId}/cancel`, c.doctor, {
      reason: 'Changed my mind here',
    });
    expectErrorShape(draft.body, 'INVALID_STATUS_TRANSITION');
    const s = await issued();
    const other = await loginAsDoctor();
    await relate(other.id, s.patientId);
    const denied = await post(`/prescriptions/${s.prescriptionId}/cancel`, other, {
      reason: 'Not my prescription',
    });
    expect(denied.status).toBe(404);
    const staff = await post(
      `/prescriptions/${s.prescriptionId}/cancel`,
      await loginAs('receptionist'),
      {
        reason: 'Front desk cancel',
      },
    );
    expect(staff.status).toBe(403);
  });

  it('reissue → a linked draft (acks cleared), edited and issued with a new number', async () => {
    const { id: patientId } = await createPatient({
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
    });
    const c = await issued({
      patientId,
      items: [
        rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin', acknowledgeAllergy: true }),
      ],
    });
    const re = await post(`/prescriptions/${c.prescriptionId}/reissue`, c.doctor, {
      reason: 'Dose needs to change to BD',
    });
    expect(re.status, JSON.stringify(re.body)).toBe(201);
    const draft = re.body.data;
    expect(draft).toMatchObject({
      status: 'draft',
      isCurrent: true,
      replaces: c.prescriptionId,
      prescriptionNumber: null,
      encounterId: c.encounterId,
    });
    expect(draft.items[0]).toMatchObject({ drugName: 'Amoxicillin', frequency: 'TDS' });
    expect(draft.items[0].allergyWarning).toMatchObject({
      substance: 'Penicillin',
      acknowledged: false,
    });
    const old = await Prescription.findById(c.prescriptionId).lean();
    expect(old).toMatchObject({ status: 'cancelled', isCurrent: false });

    // Issuing needs the acknowledgement again.
    const refused = await post(`/prescriptions/${draft.id}/issue`, c.doctor);
    expectErrorShape(refused.body, 'ALLERGY_ACK_REQUIRED');

    // The reissued draft is editable although the note is signed.
    const edited = await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: draft.revision,
      items: [rxItem({ drugName: 'Amoxicillin', frequency: 'BD', acknowledgeAllergy: true })],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const res = await post(`/prescriptions/${draft.id}/issue`, c.doctor, {
      expectedVersion: edited.body.data.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'issued',
      prescriptionNumber: expect.stringMatching(/-000002$/),
      replaces: c.prescriptionId,
    });
    expect(await auditEntries('prescription.reissue')).toHaveLength(1);
    const issues = await auditEntries('prescription.issue');
    expect(issues.map((e) => e.metadata?.via)).toEqual(['sign', 'issue']);
    // Exactly one current prescription for the encounter.
    expect(await Prescription.countDocuments({ encounter: c.encounterId, isCurrent: true })).toBe(
      1,
    );
  });

  it('parallel reissues → one 201, exactly one current prescription', async () => {
    const c = await issued();
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        post(`/prescriptions/${c.prescriptionId}/reissue`, c.doctor, {
          reason: `Parallel reissue ${n} here`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await Prescription.countDocuments({ encounter: c.encounterId })).toBe(2);
    expect(await Prescription.countDocuments({ encounter: c.encounterId, isCurrent: true })).toBe(
      1,
    );
  });

  it('issue: incomplete items → 422 with details; a first draft is issued by signing (422)', async () => {
    const c = await issued();
    const re = await post(`/prescriptions/${c.prescriptionId}/reissue`, c.doctor, {
      reason: 'Replacing with a new drug',
    });
    await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: re.body.data.revision,
      items: [{ drugName: 'Cetirizine' }],
    });
    const res = await post(`/prescriptions/${re.body.data.id}/issue`, c.doctor);
    expect(res.status).toBe(422);
    expect(expectErrorShape(res.body, 'SIGN_VALIDATION_FAILED').error.details).toEqual([
      { field: 'items.0.dose', message: 'Dose is required' },
      { field: 'items.0.frequency', message: 'Frequency is required' },
      { field: 'items.0.durationDays', message: 'Duration is required' },
    ]);

    const unsigned = await readyToSign();
    const first = await post(`/prescriptions/${unsigned.prescriptionId}/issue`, unsigned.doctor);
    expect(first.status).toBe(422);
    const issuedTwice = await post(`/prescriptions/${c.prescriptionId}/issue`, c.doctor);
    expectErrorShape(issuedTwice.body, 'INVALID_STATUS_TRANSITION');
  });
});

describe('Prescription model – locked after issue', () => {
  it('items and instructions cannot change once issued; status bookkeeping can', async () => {
    const c = await issued();
    const id = new Types.ObjectId(c.prescriptionId);
    const locked = { statusCode: 409, code: 'RECORD_LOCKED' };
    await expect(
      Prescription.updateOne({ _id: id }, { $set: { 'items.0.dose': '10 tablets' } }),
    ).rejects.toMatchObject(locked);
    await expect(
      Prescription.findOneAndUpdate({ _id: id }, { $set: { generalInstructions: 'x' } }),
    ).rejects.toMatchObject(locked);
    await expect(
      Prescription.updateOne({ _id: id }, { $set: { status: 'draft' } }),
    ).rejects.toMatchObject(locked);
    await expect(Prescription.replaceOne({ _id: id }, { items: [] })).rejects.toMatchObject(locked);
    const doc = (await Prescription.findById(id))!;
    doc.set('items.0.dose', '10 tablets');
    await expect(doc.save()).rejects.toMatchObject(locked);
    await expect(Prescription.deleteOne({ _id: id })).rejects.toMatchObject(locked);
    await expect(Prescription.deleteMany({})).rejects.toMatchObject(locked);
    // Completion (the job's update) is allowed.
    await Prescription.updateOne(
      { _id: id },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
    expect((await Prescription.findById(id).lean())?.items[0]?.dose).toBe('1 tablet');
  });
});
