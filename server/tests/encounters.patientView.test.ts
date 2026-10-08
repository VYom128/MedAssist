import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { getSettings } from '../src/modules/settings/service.js';
import { addDaysToDate, calendarDate, clinicToday } from '../src/utils/dates.js';
import { resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createPatient,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  readyToSign,
  signNote,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * The patient's own visits (Phase 8): the patient-safe note view, shareDiagnosisWithPatient,
 * GET /patients/me/visits, GET /patients/me/follow-ups-due and the patient's prescriptions.
 */

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

const get = (who: LoggedIn, path: string) => api().get(`/api/v1${path}`).set(who.auth);

const CLINICAL_NOTE = {
  chiefComplaint: 'Private complaint text',
  historyOfPresentIllness: 'Private history text',
  pastHistory: 'Private past history',
  examination: 'Private examination text',
  assessment: 'Private assessment text',
  plan: 'Private plan text',
  adviceToPatient: 'Drink plenty of fluids',
  followUp: { required: true, afterDays: 7, instructions: 'Come back if the fever persists' },
};

/** A signed note of the patient's visit (with an issued prescription). */
async function signedVisit(note: Record<string, unknown> = {}) {
  const patient = await loginAsPatient();
  const c = await readyToSign({
    patientId: patient.patientId,
    note: { ...CLINICAL_NOTE, ...note },
  });
  await signNote(c.doctor, c.encounterId);
  return { ...c, patient };
}

describe('GET /encounters/:id – patient-safe view', () => {
  it('hides history, examination, assessment and plan; no diagnoses unless shared', async () => {
    const c = await signedVisit();
    const res = await get(c.patient, `/encounters/${c.encounterId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: c.encounterId,
      status: 'signed',
      doctor: { id: c.doctor.id },
      vitals: { temperatureC: 38.4, pulse: 96 },
      adviceToPatient: 'Drink plenty of fluids',
      followUp: { required: true, afterDays: 7, instructions: 'Come back if the fever persists' },
      diagnosisShared: false,
      diagnoses: null,
      prescriptionId: c.prescriptionId,
      labOrders: [],
    });
    expect(res.body.data).toHaveProperty('department');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Private|pharyngitis|recordedBy|revision/);
    for (const key of [
      'chiefComplaint',
      'historyOfPresentIllness',
      'pastHistory',
      'examination',
      'assessment',
      'plan',
    ]) {
      expect(res.body.data, key).not.toHaveProperty(key);
    }
  });

  it('shows the diagnoses when the doctor ticked "share diagnosis" before signing', async () => {
    const c = await signedVisit({ shareDiagnosisWithPatient: true });
    const res = await get(c.patient, `/encounters/${c.encounterId}`);
    expect(res.body.data.diagnosisShared).toBe(true);
    expect(res.body.data.diagnoses).toEqual([
      expect.objectContaining({ description: 'Acute pharyngitis', isPrimary: true }),
    ]);
    // The doctor's view carries the flag.
    const doctor = await get(c.doctor, `/encounters/${c.encounterId}`);
    expect(doctor.body.data.shareDiagnosisWithPatient).toBe(true);
  });

  it('after signing the flag changes only through an amendment', async () => {
    const c = await signedVisit();
    const patch = await api()
      .patch(`/api/v1/encounters/${c.encounterId}`)
      .set(c.doctor.auth)
      .send({ expectedVersion: 99, shareDiagnosisWithPatient: true });
    expect(patch.status).toBe(409);
    expectErrorShape(patch.body, 'RECORD_LOCKED');

    const amend = await api()
      .post(`/api/v1/encounters/${c.encounterId}/amendments`)
      .set(c.doctor.auth)
      .send({
        reason: 'Patient asked to see the diagnosis',
        changes: { shareDiagnosisWithPatient: true },
      });
    expect(amend.status, JSON.stringify(amend.body)).toBe(201);
    const amendment = await NoteAmendment.findOne({ encounter: c.encounterId }).lean();
    expect(amendment?.changedFields).toEqual(['shareDiagnosisWithPatient']);

    const res = await get(c.patient, `/encounters/${c.encounterId}`);
    expect(res.body.data).toMatchObject({
      status: 'amended',
      amended: true,
      diagnosisShared: true,
    });
    expect(res.body.data.diagnoses).toHaveLength(1);

    // Unchanged flag → nothing to amend.
    const same = await api()
      .post(`/api/v1/encounters/${c.encounterId}/amendments`)
      .set(c.doctor.auth)
      .send({ reason: 'Same value again here', changes: { shareDiagnosisWithPatient: true } });
    expect(same.status).toBe(422);
  });

  it('drafts and other patients’ notes are 404; patients still cannot write', async () => {
    const patient = await loginAsPatient();
    const draft = await startedConsultation(undefined, { patientId: patient.patientId });
    const res = await get(patient, `/encounters/${draft.encounterId}`);
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');

    const other = await signedVisit();
    expect((await get(patient, `/encounters/${other.encounterId}`)).status).toBe(404);
    // Patients may read but never list, edit, sign or amend notes.
    expect((await get(other.patient, '/encounters')).status).toBe(403);
    expect((await get(other.patient, `/encounters/${other.encounterId}/amendments`)).status).toBe(
      403,
    );
    const patch = await api()
      .patch(`/api/v1/encounters/${other.encounterId}`)
      .set(other.patient.auth)
      .send({ expectedVersion: 0, plan: 'x' });
    expect(patch.status).toBe(403);
  });
});

describe('GET /patients/me/visits', () => {
  it('lists signed visits only, with the primary diagnosis only when shared', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor();
    const shared = await readyToSign({
      doctor,
      patientId: patient.patientId,
      items: [],
      note: { shareDiagnosisWithPatient: true },
    });
    await signNote(doctor, shared.encounterId);
    const hidden = await readyToSign({ doctor, patientId: patient.patientId, items: [] });
    await signNote(doctor, hidden.encounterId);
    await startedConsultation(doctor, { patientId: patient.patientId }); // a draft

    const res = await get(patient, '/patients/me/visits');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 2 });
    const byId = new Map(
      (res.body.data as { id: string; primaryDiagnosis: string | null }[]).map((v) => [v.id, v]),
    );
    expect(byId.get(shared.encounterId)?.primaryDiagnosis).toBe('Acute pharyngitis');
    expect(byId.get(hidden.encounterId)?.primaryDiagnosis).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/Fever and sore throat/);
  });
});

describe('GET /patients/me/follow-ups-due', () => {
  /** A signed note of the patient's completed visit with a follow-up due on `dueDate`. */
  async function plannedNote(
    patientId: string,
    doctorId: string,
    { dueDate, daysAgo = 3 }: { dueDate: string; daysAgo?: number },
  ) {
    const visitAt = new Date(Date.now() - daysAgo * 86_400_000);
    const visit = await insertAppointment({
      patient: patientId,
      doctor: doctorId,
      startAt: visitAt,
      status: 'completed',
      isSlotActive: false,
    });
    const e = await Encounter.create({
      encounterNumber: `ENC-1999-${new Types.ObjectId().toString().slice(-6)}`,
      appointment: visit._id,
      patient: patientId,
      doctor: doctorId,
      visitAt,
      status: 'signed',
      signedAt: visitAt,
      followUp: { required: true, date: calendarDate(dueDate), instructions: 'Bring the BP diary' },
    });
    return { visit, encounterId: e._id.toString() };
  }

  it('lists upcoming and recently overdue follow-ups that are not booked, soonest first', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor();
    const second = await loginAsDoctor();
    const { timezone } = await getSettings();
    const today = clinicToday(timezone);
    const upcoming = await plannedNote(patient.patientId, doctor.id, {
      dueDate: addDaysToDate(today, 5),
    });
    const overdue = await plannedNote(patient.patientId, second.id, {
      dueDate: addDaysToDate(today, -14),
      daysAgo: 40,
    });
    // Overdue by more than 14 days: dropped.
    await plannedNote(patient.patientId, second.id, {
      dueDate: addDaysToDate(today, -15),
      daysAgo: 60,
    });
    // Another patient's note never shows.
    await plannedNote((await createPatient()).id, doctor.id, { dueDate: addDaysToDate(today, 2) });

    const res = await get(patient, '/patients/me/follow-ups-due');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ encounterId: overdue.encounterId, overdue: true }),
      expect.objectContaining({
        encounterId: upcoming.encounterId,
        dueDate: addDaysToDate(today, 5),
        overdue: false,
        instructions: 'Bring the BP diary',
        doctor: expect.objectContaining({ id: doctor.id }),
        booking: {
          doctorId: doctor.id,
          followUpOf: upcoming.visit._id.toString(),
          type: 'follow_up',
        },
      }),
    ]);
  });

  it('an earlier plan counts as booked once a later visit with that doctor exists', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor();
    const { timezone } = await getSettings();
    const today = clinicToday(timezone);
    await plannedNote(patient.patientId, doctor.id, {
      dueDate: addDaysToDate(today, -3),
      daysAgo: 30,
    });
    const latest = await plannedNote(patient.patientId, doctor.id, {
      dueDate: addDaysToDate(today, 10),
    });
    const res = await get(patient, '/patients/me/follow-ups-due');
    expect(res.body.data.map((d: { encounterId: string }) => d.encounterId)).toEqual([
      latest.encounterId,
    ]);
  });

  it('shows an overdue follow-up within 14 days, and drops it once booked', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor();
    const { timezone } = await getSettings();
    const today = clinicToday(timezone);
    const due = await plannedNote(patient.patientId, doctor.id, {
      dueDate: addDaysToDate(today, -2),
      daysAgo: 20,
    });
    const first = await get(patient, '/patients/me/follow-ups-due');
    expect(first.body.data).toEqual([
      expect.objectContaining({ encounterId: due.encounterId, overdue: true }),
    ]);

    // A cancelled booking does not count …
    const later = new Date(Date.now() + 2 * 86_400_000);
    const booked = await insertAppointment({
      patient: patient.patientId,
      doctor: doctor.id,
      startAt: later,
      status: 'cancelled',
      isSlotActive: false,
    });
    expect((await get(patient, '/patients/me/follow-ups-due')).body.data).toHaveLength(1);
    // … a scheduled one with the same doctor does.
    await Appointment.updateOne(
      { _id: booked._id },
      { $set: { status: 'scheduled', isSlotActive: true } },
    );
    expect((await get(patient, '/patients/me/follow-ups-due')).body.data).toEqual([]);
  });

  it('a booking linked with followUpOf counts even with another doctor', async () => {
    const patient = await loginAsPatient();
    const doctor = await loginAsDoctor();
    const other = await loginAsDoctor();
    const { timezone } = await getSettings();
    const due = await plannedNote(patient.patientId, doctor.id, {
      dueDate: addDaysToDate(clinicToday(timezone), 3),
    });
    await insertAppointment({
      patient: patient.patientId,
      doctor: other.id,
      startAt: new Date(Date.now() + 3 * 86_400_000),
      type: 'follow_up',
      followUpOf: due.visit._id,
    });
    expect((await get(patient, '/patients/me/follow-ups-due')).body.data).toEqual([]);
  });

  it('is for linked patients only', async () => {
    const doctor = await loginAsDoctor();
    expect((await get(doctor, '/patients/me/follow-ups-due')).status).toBe(403);
  });
});

describe('GET /prescriptions (patient)', () => {
  it('returns the patient’s issued prescriptions only, with printed frequency labels', async () => {
    const c = await signedVisit();
    // A draft (reissued) prescription of another visit of the same patient stays hidden.
    const draft = await readyToSign({ patientId: c.patient.patientId });
    const list = await get(c.patient, '/prescriptions');
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([c.prescriptionId]);
    expect(list.body.data[0].status).toBe('issued');

    const one = await get(c.patient, `/prescriptions/${c.prescriptionId}`);
    expect(one.status).toBe(200);
    expect(one.body.data.items[0]).toMatchObject({
      frequency: 'TDS',
      frequencyLabel: 'Three times a day',
    });
    expect(one.body.data).not.toHaveProperty('allergyWarnings');
    expect((await get(c.patient, `/prescriptions/${draft.prescriptionId}`)).status).toBe(404);
  });
});
