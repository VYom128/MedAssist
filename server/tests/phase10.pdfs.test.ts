import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { ClinicalSummary } from '../src/modules/summaries/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  checkedInToday,
  createPatient,
  insertAppointment,
  loginAsDoctor,
  loginAsPatient,
  readyToSign,
  rxItem,
  setSettings,
  signNote,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { isPdf, pdfText } from './helpers/pdf.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Phase 10 PDFs, made on demand: the patient-safe visit summary (approved AI summary only when
 * shared) and the appointment slip. Private, no-store, audited downloads.
 */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    ClinicalSummary.init(),
  ]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const binary = (who: LoggedIn, path: string) =>
  api()
    .get(`/api/v1${path}`)
    .set(who.auth)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

/** A signed note with history, examination and an issued prescription for a portal patient. */
async function signedVisit() {
  const patient = await loginAsPatient();
  const c = await readyToSign({
    patientId: patient.patientId,
    note: {
      historyOfPresentIllness: 'PRIVATEHISTORY of throat pain',
      examination: 'PRIVATEEXAM tonsils enlarged',
      adviceToPatient: 'Warm saline gargles twice a day',
      followUp: { required: true, afterDays: 5, instructions: 'Come back if the fever persists' },
    },
    items: [
      rxItem({
        drugName: 'Amoxicillin',
        genericName: 'Amoxicillin',
        strength: '500 mg',
        dose: '1 capsule',
      }),
    ],
  });
  await signNote(c.doctor, c.encounterId);
  const e = await Encounter.findById(c.encounterId).lean();
  return { ...c, patient, encounterNumber: e!.encounterNumber! };
}

/** An approved AI summary with recognisable text, shared or not. */
async function approvedSummary(c: Awaited<ReturnType<typeof signedVisit>>, share: boolean) {
  const base = `/api/v1/encounters/${c.encounterId}/summary`;
  const gen = await api().post(`${base}/generate`).set(c.doctor.auth);
  expect(gen.status, JSON.stringify(gen.body)).toBe(201);
  const id = gen.body.data.id as string;
  await api()
    .patch(`${base}/${id}`)
    .set(c.doctor.auth)
    .send({ expectedVersion: 0, finalText: 'SUMMARYMARKER the visit went well.' });
  const ok = await api()
    .post(`${base}/${id}/approve`)
    .set(c.doctor.auth)
    .send({ shareWithPatient: share });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
}

describe('GET /encounters/:id/visit-summary.pdf', () => {
  it('gives the patient a patient-safe PDF with the prescription – private, audited', async () => {
    const c = await signedVisit();
    const res = await binary(c.patient, `/encounters/${c.encounterId}/visit-summary.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(isPdf(res.body)).toBe(true);
    const text = pdfText(res.body);
    expect(text).toContain('VISIT SUMMARY');
    expect(text).toContain(c.encounterNumber);
    expect(text).toContain('Amoxicillin');
    expect(text).toContain('Warm saline gargles');
    expect(text).toContain('Come back after 5 days');
    expect(text).not.toMatch(/PRIVATEHISTORY|PRIVATEEXAM/);
    expect(text).not.toContain('SUMMARYMARKER');
    const [entry] = await auditEntries('encounter.visit_summary_download');
    expect(entry).toMatchObject({
      resource: { type: 'encounter' },
      metadata: { aiSummaryIncluded: false },
    });
  });

  it('includes the approved AI summary only when the doctor shared it', async () => {
    const hidden = await signedVisit();
    await approvedSummary(hidden, false);
    const a = await binary(hidden.patient, `/encounters/${hidden.encounterId}/visit-summary.pdf`);
    expect(pdfText(a.body)).not.toContain('SUMMARYMARKER');

    const shared = await signedVisit();
    await approvedSummary(shared, true);
    const b = await binary(shared.patient, `/encounters/${shared.encounterId}/visit-summary.pdf`);
    expect(pdfText(b.body)).toContain('SUMMARYMARKER');
    // The doctor's copy is the same patient handout.
    const d = await binary(shared.doctor, `/encounters/${shared.encounterId}/visit-summary.pdf`);
    expect(d.status).toBe(200);
    expect(pdfText(d.body)).not.toMatch(/PRIVATEHISTORY|PRIVATEEXAM/);
  });

  it('never for drafts, other patients or unrelated doctors', async () => {
    const c = await signedVisit();
    const other = await loginAsPatient();
    const stranger = await loginAsDoctor();
    const path = `/encounters/${c.encounterId}/visit-summary.pdf`;
    expectErrorShape((await api().get(`/api/v1${path}`).set(other.auth)).body, 'NOT_FOUND');
    expectErrorShape((await api().get(`/api/v1${path}`).set(stranger.auth)).body, 'NOT_FOUND');
    const reception = await loginAs('receptionist');
    expect((await api().get(`/api/v1${path}`).set(reception.auth)).status).toBe(403);

    const draft = await readyToSign({ patientId: c.patient.patientId, doctor: c.doctor });
    const draftPath = `/api/v1/encounters/${draft.encounterId}/visit-summary.pdf`;
    expect((await api().get(draftPath).set(c.patient.auth)).status).toBe(404);
    const own = await api().get(draftPath).set(c.doctor.auth);
    expect(own.status).toBe(422);
  });
});

describe('GET /appointments/:id/slip.pdf', () => {
  it('reception prints the slip: number, clinic time, token once checked in, arrive early', async () => {
    const doctor = await loginAsDoctor();
    const patient = await loginAsPatient();
    const { appointmentId } = await checkedInToday(doctor.id, { patientId: patient.patientId });
    const appt = await Appointment.findById(appointmentId).lean();
    const reception = await loginAs('receptionist');
    const res = await binary(reception, `/appointments/${appointmentId}/slip.pdf`);
    expect(res.status).toBe(200);
    expect(isPdf(res.body)).toBe(true);
    const text = pdfText(res.body);
    expect(text).toContain('APPOINTMENT SLIP');
    expect(text).toContain(appt!.appointmentNumber);
    expect(text).toContain(String(appt!.queue!.tokenNumber));
    expect(text).toContain('Please arrive 10 minutes early');
    expect((await auditEntries('appointment.slip_download')).length).toBe(1);

    // The patient's own slip; another patient's is 404; doctors are not slip readers.
    expect((await binary(patient, `/appointments/${appointmentId}/slip.pdf`)).status).toBe(200);
    const other = await loginAsPatient();
    expect(
      (await api().get(`/api/v1/appointments/${appointmentId}/slip.pdf`).set(other.auth)).status,
    ).toBe(404);
    expect(
      (await api().get(`/api/v1/appointments/${appointmentId}/slip.pdf`).set(doctor.auth)).status,
    ).toBe(403);
  });

  it('a scheduled appointment has no token', async () => {
    const doctor = await loginAsDoctor();
    const p = await createPatient();
    const a = await insertAppointment({
      patient: p.id,
      doctor: doctor.id,
      startAt: new Date(Date.now() + 3 * 86_400_000),
    });
    const admin = await loginAs('admin');
    const res = await binary(admin, `/appointments/${a._id.toString()}/slip.pdf`);
    expect(res.status).toBe(200);
    expect(pdfText(res.body)).toContain(a.appointmentNumber);
  });

  it('prints the time in the clinic timezone, not UTC', async () => {
    await setSettings({ timezone: 'Asia/Kolkata' });
    const doctor = await loginAsDoctor();
    const p = await createPatient();
    const a = await insertAppointment({
      patient: p.id,
      doctor: doctor.id,
      startAt: new Date('2026-12-01T04:00:00.000Z'), // 09:30 in Kolkata
    });
    const admin = await loginAs('admin');
    const text = pdfText((await binary(admin, `/appointments/${a._id.toString()}/slip.pdf`)).body);
    expect(text).toContain('01 Dec 2026, 9:30 AM');
    expect(text).not.toContain('4:00 AM');
  });
});
