import type { Server } from 'socket.io';
import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createPatient,
  loginAsDoctor,
  putPrescription,
  readyToSign,
  rxItem,
  signNote,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** POST /encounters/:id/sign (spec §4.7 step 5, §8.5, §8.6). */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init(), Prescription.init()]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => {
  emails.restore();
  vi.restoreAllMocks();
});

const sign = (doctor: LoggedIn, id: string, expectedVersion: number) =>
  api().post(`/api/v1/encounters/${id}/sign`).set(doctor.auth).send({ expectedVersion });

/** State of the three records signing touches. */
async function stateOf(c: { encounterId: string; appointmentId: string }) {
  const [e, rx, appt] = await Promise.all([
    Encounter.findById(c.encounterId).lean(),
    Prescription.findOne({ encounter: c.encounterId, isCurrent: true }).lean(),
    Appointment.findById(c.appointmentId).lean(),
  ]);
  return { note: e?.status, rx: rx?.status ?? null, appointment: appt?.status };
}

describe('signing', () => {
  it('signs the note, issues the prescription and completes the appointment in one step', async () => {
    const events: [string[], string, unknown][] = [];
    setSocketServer({
      to: (rooms: string[]) => ({
        emit: (event: string, payload: unknown) => events.push([rooms, event, payload]),
      }),
    } as unknown as Server);
    try {
      const c = await readyToSign();
      const res = await sign(c.doctor, c.encounterId, c.revision);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = res.body.data;
      expect(data.encounter).toMatchObject({
        id: c.encounterId,
        status: 'signed',
        version: 1,
        revision: c.revision + 1,
        signedBy: c.doctor.id,
        signedAt: expect.any(String),
      });
      expect(data.prescription).toMatchObject({
        id: c.prescriptionId,
        status: 'issued',
        prescriptionNumber: expect.stringMatching(/^RX-\d{4}-000001$/),
        issuedAt: expect.any(String),
      });
      expect(data.appointment).toEqual({ id: c.appointmentId, status: 'completed' });
      expect(data.warnings).toEqual([]);
      expect(await stateOf(c)).toEqual({ note: 'signed', rx: 'issued', appointment: 'completed' });
      expect((await Appointment.findById(c.appointmentId).lean())?.queue?.completedAt).toBeTruthy();

      // Queue update for the doctor's day, ids only.
      const queue = events.find(([, event]) => event === 'queue.updated');
      expect(queue?.[2]).toEqual({ doctorId: c.doctor.id, date: expect.any(String) });
      expect(JSON.stringify(events)).not.toMatch(/pharyngitis|Paracetamol|Fever/);
    } finally {
      setSocketServer(null);
    }
  });

  it('audits sign, issue and completion with no clinical text', async () => {
    const c = await readyToSign();
    await sign(c.doctor, c.encounterId, c.revision);
    const [signed] = await auditEntries('encounter.sign');
    expect(signed).toMatchObject({
      resource: { type: 'encounter' },
      metadata: { prescriptionIssued: true, appointmentCompleted: true },
    });
    expect(signed?.patient?.toString()).toBe(c.patientId);
    const [issued] = await auditEntries('prescription.issue');
    expect(issued?.resource?.number).toMatch(/^RX-/);
    expect(issued?.metadata).toMatchObject({ via: 'sign', itemCount: 1 });
    expect(await auditEntries('appointment.complete')).toHaveLength(1);
    const stored = JSON.stringify([signed, issued]);
    expect(stored).not.toMatch(/pharyngitis|Paracetamol|Fever|sore throat|J02/);
  });

  it('empty vitals are a warning, not a block', async () => {
    const c = await readyToSign({ note: { vitals: { temperatureC: null, pulse: null } } });
    const res = await sign(c.doctor, c.encounterId, c.revision);
    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toEqual(['No vitals were recorded for this visit.']);
  });

  it('without a prescription (or with an empty draft) the note is signed, nothing is issued', async () => {
    const none = await readyToSign({ items: [] });
    const a = await sign(none.doctor, none.encounterId, none.revision);
    expect(a.body.data.prescription).toBeNull();
    expect(await auditEntries('prescription.issue')).toHaveLength(0);

    const empty = await readyToSign({ items: [] });
    await putPrescription(empty.doctor, empty.encounterId, { items: [] });
    const b = await sign(empty.doctor, empty.encounterId, empty.revision);
    expect(b.status).toBe(200);
    expect(b.body.data.prescription).toBeNull();
    expect((await Prescription.findOne({ encounter: empty.encounterId }).lean())?.status).toBe(
      'draft',
    );
  });

  it('signing twice → 409 INVALID_STATUS_TRANSITION', async () => {
    const c = await readyToSign();
    await sign(c.doctor, c.encounterId, c.revision);
    const again = await sign(c.doctor, c.encounterId, c.revision + 1);
    expect(again.status).toBe(409);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');
  });

  it('parallel signs → one 200, one prescription number', async () => {
    const c = await readyToSign();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => sign(c.doctor, c.encounterId, c.revision)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await auditEntries('encounter.sign')).toHaveLength(1);
    expect(await Prescription.countDocuments({ prescriptionNumber: { $type: 'string' } })).toBe(1);
  });

  it('a stale revision → 409 CONFLICT (sign what you see)', async () => {
    const c = await readyToSign();
    const res = await sign(c.doctor, c.encounterId, c.revision - 1);
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'CONFLICT');
    expect(await stateOf(c)).toEqual({
      note: 'draft',
      rx: 'draft',
      appointment: 'in_consultation',
    });
  });

  it('another doctor → 404 (audited); staff → 403; expectedVersion required', async () => {
    const c = await readyToSign();
    const other = await loginAsDoctor();
    expect((await sign(other, c.encounterId, c.revision)).status).toBe(404);
    expect(await auditEntries('access.denied')).toHaveLength(1);
    for (const role of ['admin', 'receptionist', 'patient'] as const) {
      expect((await sign(await loginAs(role), c.encounterId, c.revision)).status).toBe(403);
    }
    const missing = await api()
      .post(`/api/v1/encounters/${c.encounterId}/sign`)
      .set(c.doctor.auth)
      .send({});
    expectErrorShape(missing.body, 'VALIDATION_ERROR');
  });
});

describe('sign validation (422 SIGN_VALIDATION_FAILED)', () => {
  it('lists what is missing: chief complaint and a diagnosis', async () => {
    const c = await startedConsultation();
    const res = await sign(c.doctor, c.encounterId, 0);
    expect(res.status).toBe(422);
    const body = expectErrorShape(res.body, 'SIGN_VALIDATION_FAILED');
    expect(body.error.details).toEqual([
      { field: 'chiefComplaint', message: 'Chief complaint is required' },
      { field: 'diagnoses', message: 'Add at least one diagnosis' },
    ]);
    expect((await Encounter.findById(c.encounterId).lean())?.status).toBe('draft');
  });

  it('lists incomplete prescription items', async () => {
    const c = await readyToSign({
      items: [
        rxItem(),
        { drugName: 'Cetirizine' },
        rxItem({ drugName: 'Ondansetron', frequency: 'other', frequencyText: 'If vomiting' }),
      ],
    });
    // 'other' without text is refused at input; make the stored item lack it.
    await Prescription.updateOne(
      { _id: c.prescriptionId },
      { $unset: { 'items.2.frequencyText': '' } },
    );
    const res = await sign(c.doctor, c.encounterId, c.revision);
    expect(res.status).toBe(422);
    expect(expectErrorShape(res.body, 'SIGN_VALIDATION_FAILED').error.details).toEqual([
      { field: 'prescription.items.1.dose', message: 'Dose is required' },
      { field: 'prescription.items.1.frequency', message: 'Frequency is required' },
      { field: 'prescription.items.1.durationDays', message: 'Duration is required' },
      { field: 'prescription.items.2.frequencyText', message: 'Describe the frequency' },
    ]);
    expect(await stateOf(c)).toEqual({
      note: 'draft',
      rx: 'draft',
      appointment: 'in_consultation',
    });
  });
});

describe('allergy acknowledgement (spec §8.6)', () => {
  async function allergicPatient(substance = 'Penicillin') {
    return (await createPatient({ allergies: [{ substance, severity: 'severe' }] })).id;
  }

  it('the draft shows the warning; signing needs the acknowledgement', async () => {
    const patientId = await allergicPatient();
    const c = await readyToSign({
      patientId,
      items: [rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin', strength: '500 mg' })],
    });
    const draft = await api().get(`/api/v1/prescriptions/${c.prescriptionId}`).set(c.doctor.auth);
    expect(draft.body.data.allergyWarnings).toEqual([
      {
        itemIndex: 0,
        drugName: 'Amoxicillin',
        substance: 'Penicillin',
        matchedOn: 'class',
        drugClass: 'Penicillins',
        acknowledged: false,
      },
    ]);
    expect(draft.body.data.allergyCheckNotice).toMatch(/not clinical decision support/);

    const refused = await sign(c.doctor, c.encounterId, c.revision);
    expect(refused.status).toBe(422);
    const body = expectErrorShape(refused.body, 'ALLERGY_ACK_REQUIRED');
    expect(body.error.details).toEqual([
      expect.objectContaining({
        field: 'prescription.items.0',
        itemIndex: 0,
        substance: 'Penicillin',
        drugClass: 'Penicillins',
      }),
    ]);
    // The message (which is logged) names no drug or allergy.
    expect(body.message).not.toMatch(/amoxicillin|penicillin/i);
    expect(await stateOf(c)).toEqual({
      note: 'draft',
      rx: 'draft',
      appointment: 'in_consultation',
    });

    const acked = await putPrescription(c.doctor, c.encounterId, {
      expectedVersion: draft.body.data.revision,
      items: [
        rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin', acknowledgeAllergy: true }),
      ],
    });
    expect(acked.body.data.items[0].allergyWarning).toMatchObject({
      acknowledged: true,
      acknowledgedBy: c.doctor.id,
      acknowledgedAt: expect.any(String),
    });
    const res = await sign(c.doctor, c.encounterId, c.revision);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const issued = await Prescription.findById(c.prescriptionId).lean();
    expect(issued?.items[0]?.allergyWarning).toMatchObject({
      substance: 'Penicillin',
      matchedOn: 'class',
      drugClass: 'Penicillins',
    });
    expect(issued?.items[0]?.allergyWarning?.acknowledgedBy?.toString()).toBe(c.doctor.id);
  });

  it('an allergy recorded after drafting blocks signing until acknowledged', async () => {
    const c = await readyToSign({
      items: [rxItem({ drugName: 'Ibuprofen', genericName: 'Ibuprofen' })],
    });
    await Patient.updateOne(
      { _id: c.patientId },
      { $push: { allergies: { substance: 'NSAIDs', severity: 'moderate' } } },
    );
    const res = await sign(c.doctor, c.encounterId, c.revision);
    expect(res.status).toBe(422);
    expect(expectErrorShape(res.body, 'ALLERGY_ACK_REQUIRED').error.details).toEqual([
      expect.objectContaining({ substance: 'NSAIDs', drugClass: 'NSAIDs' }),
    ]);
  });
});

describe('atomicity and the documentation window', () => {
  it('a failure in the middle of the transaction leaves note, prescription and appointment unchanged', async () => {
    const c = await readyToSign();
    // The appointment update is the last write of the transaction: make it fail.
    const spy = vi.spyOn(Appointment, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Simulated failure');
    });
    const res = await sign(c.doctor, c.encounterId, c.revision);
    expect(res.status).toBe(500);
    spy.mockRestore();
    expect(await stateOf(c)).toEqual({
      note: 'draft',
      rx: 'draft',
      appointment: 'in_consultation',
    });
    const rx = await Prescription.findById(c.prescriptionId).lean();
    expect(rx?.prescriptionNumber).toBeUndefined();
    expect(await auditEntries('encounter.sign')).toHaveLength(0);
    // Nothing was half-done: signing again works and takes the first RX number.
    const again = await sign(c.doctor, c.encounterId, c.revision);
    expect(again.status).toBe(200);
    expect(again.body.data.prescription.prescriptionNumber).toMatch(/-000001$/);
  });

  it('late documentation: signable up to 72 h after completion; the appointment stays completed', async () => {
    const c = await readyToSign();
    const complete = (hoursAgo: number) =>
      Appointment.updateOne(
        { _id: c.appointmentId },
        {
          $set: {
            status: 'completed',
            isSlotActive: true,
            'queue.completedAt': new Date(Date.now() - hoursAgo * 3_600_000),
          },
        },
      );
    await complete(73);
    const late = await sign(c.doctor, c.encounterId, c.revision);
    expect(late.status).toBe(422);
    expectErrorShape(late.body, 'DOCUMENTATION_WINDOW_CLOSED');
    await complete(10);
    const res = await sign(c.doctor, c.encounterId, c.revision);
    expect(res.status).toBe(200);
    expect(res.body.data.appointment.status).toBe('completed');
    expect(res.body.data.encounter.status).toBe('signed');
    expect(await auditEntries('appointment.complete')).toHaveLength(0);
  });

  it('after signing, the note and its prescription are locked', async () => {
    const c = await readyToSign();
    await signNote(c.doctor, c.encounterId);
    const note = await api()
      .patch(`/api/v1/encounters/${c.encounterId}`)
      .set(c.doctor.auth)
      .send({ expectedVersion: c.revision + 1, plan: 'Changed' });
    expect(note.status).toBe(409);
    expectErrorShape(note.body, 'RECORD_LOCKED');
    const rx = await putPrescription(c.doctor, c.encounterId, { expectedVersion: 1, items: [] });
    expect(rx.status).toBe(409);
    expectErrorShape(rx.body, 'RECORD_LOCKED');
  });
});
