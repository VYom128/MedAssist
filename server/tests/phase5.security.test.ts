import { symbols } from 'pino';
import type { Server } from 'socket.io';
import { runPrescriptionCompletionJob } from '../src/jobs/prescriptionCompletion.job.js';
import { Appointment } from '../src/modules/appointments/model.js';
import { AuditLog } from '../src/modules/audit/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { setSocketServer } from '../src/socket/emitter.js';
import { logger } from '../src/utils/logger.js';
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
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * Phase 5 security review (spec §2.3, §10.3–10.5), end to end: a doctor without a care
 * relationship is refused on every patient-specific route; admins and receptionists never read
 * notes; and a full consultation leaves no clinical text in audit entries, log lines or socket
 * payloads.
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

/** Words of the clinical content used below – none may appear in audit, logs or events. */
const CLINICAL =
  /Wheezing|breathless|asthma|bronchospasm|Amoxicillin|Salbutamol|Penicillin|inhaler|J45|nebulise/i;

/** A doctor's patient with a signed, amended note and an issued prescription. */
async function careRecord() {
  const { id: patientId } = await createPatient({
    allergies: [{ substance: 'Penicillin', severity: 'severe' }],
  });
  const c = await readyToSign({
    patientId,
    note: {
      chiefComplaint: 'Wheezing and breathless at night',
      diagnoses: [
        { description: 'Acute asthma exacerbation', icd10Code: 'J45.9', isPrimary: true },
      ],
      plan: 'Salbutamol inhaler, review in a week',
    },
    items: [
      rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin', acknowledgeAllergy: true }),
      rxItem({ drugName: 'Salbutamol inhaler', genericName: 'Salbutamol' }),
    ],
  });
  await signNote(c.doctor, c.encounterId);
  const amend = await api()
    .post(`/api/v1/encounters/${c.encounterId}/amendments`)
    .set(c.doctor.auth)
    .send({
      reason: 'Added bronchospasm finding noted later',
      changes: { examination: 'Bilateral wheeze, no bronchospasm at rest' },
    });
  expect(amend.status).toBe(201);
  return { ...c, patientId, prescriptionId: c.prescriptionId! };
}

describe('doctors without a care relationship', () => {
  it('get 404 on every patient-specific route (audited as access.denied)', async () => {
    const c = await careRecord();
    const stranger = await loginAsDoctor();
    // A cancelled appointment does not create a relationship either.
    await insertAppointment({
      patient: c.patientId,
      doctor: stranger.id,
      startAt: new Date(Date.now() + 3 * 86_400_000),
      status: 'cancelled',
      isSlotActive: false,
    });
    const reqs: [string, string, object?][] = [
      ['get', `/patients/${c.patientId}`],
      ['patch', `/patients/${c.patientId}/clinical-profile`, { chronicConditions: [] }],
      ['get', `/encounters?patient=${c.patientId}`],
      ['get', `/encounters/${c.encounterId}`],
      ['get', `/encounters/${c.encounterId}/amendments`],
      ['patch', `/encounters/${c.encounterId}`, { expectedVersion: 0, plan: 'x' }],
      ['post', `/encounters/${c.encounterId}/sign`, { expectedVersion: 0 }],
      [
        'post',
        `/encounters/${c.encounterId}/amendments`,
        { reason: 'Not my patient here', changes: { plan: 'x' } },
      ],
      ['put', `/encounters/${c.encounterId}/prescription`, { items: [] }],
      ['get', `/appointments/${c.appointmentId}/encounter`],
      ['get', `/prescriptions?patient=${c.patientId}`],
      ['get', `/prescriptions/${c.prescriptionId}`],
      ['get', `/prescriptions/${c.prescriptionId}/print`],
      ['post', `/prescriptions/${c.prescriptionId}/cancel`, { reason: 'Not my patient here' }],
      ['post', `/prescriptions/${c.prescriptionId}/reissue`, { reason: 'Not my patient here' }],
      ['post', `/prescriptions/${c.prescriptionId}/issue`, {}],
    ];
    const before = (await auditEntries('access.denied')).length;
    for (const [method, path, body] of reqs) {
      let req = (
        api() as unknown as Record<string, (p: string) => ReturnType<ReturnType<typeof api>['get']>>
      )[method]!(`/api/v1${path}`).set(stranger.auth);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(CLINICAL);
    }
    expect((await auditEntries('access.denied')).length - before).toBe(reqs.length);
    // The stranger's own list shows nothing of this patient.
    const mine = await api().get('/api/v1/patients?scope=mine').set(stranger.auth);
    expect(mine.body.data).toEqual([]);
    const notes = await api().get('/api/v1/encounters').set(stranger.auth);
    expect(notes.body.data).toEqual([]);
  });

  it('admins and receptionists cannot read notes or amendments (403), nor edit prescriptions', async () => {
    const c = await careRecord();
    for (const role of ['admin', 'receptionist'] as const) {
      const who: LoggedIn = await loginAs(role);
      for (const path of [
        '/encounters',
        `/encounters/${c.encounterId}`,
        `/encounters/${c.encounterId}/amendments`,
        `/appointments/${c.appointmentId}/encounter`,
      ]) {
        const res = await api().get(`/api/v1${path}`).set(who.auth);
        expect(res.status, `${role} ${path}`).toBe(403);
      }
      const put = await putPrescription(who, c.encounterId, { items: [] });
      expect(put.status).toBe(403);
    }
    // Admins read no prescriptions at all; reception only the printable issued view.
    const admin = await loginAs('admin');
    expect(
      (await api().get(`/api/v1/prescriptions/${c.prescriptionId}`).set(admin.auth)).status,
    ).toBe(403);
  });
});

describe('no clinical text leaves the clinical records', () => {
  it('audit entries, log lines and socket payloads of a full consultation carry none', async () => {
    const lines: string[] = [];
    const target = logger as unknown as Record<symbol, unknown>;
    const originalStream = target[symbols.streamSym];
    const originalLevel = logger.level;
    target[symbols.streamSym] = { write: (line: string) => lines.push(line) };
    logger.level = 'trace';
    const events: unknown[] = [];
    setSocketServer({
      to: (rooms: string[]) => ({ emit: (e: string, p: unknown) => events.push([rooms, e, p]) }),
    } as unknown as Server);
    try {
      const c = await careRecord();
      // Refused requests are logged too (their messages must not name drugs or allergies).
      const again = await readyToSign({
        doctor: c.doctor,
        patientId: c.patientId,
        items: [rxItem({ drugName: 'Amoxicillin', genericName: 'Amoxicillin' })],
      });
      const refused = await api()
        .post(`/api/v1/encounters/${again.encounterId}/sign`)
        .set(c.doctor.auth)
        .send({ expectedVersion: again.revision });
      expect(refused.status).toBe(422);
      await api().get(`/api/v1/prescriptions/${c.prescriptionId}/print`).set(c.doctor.auth);
      await runPrescriptionCompletionJob(new Date(Date.now() + 30 * 86_400_000));
      await flushAudit();
    } finally {
      target[symbols.streamSym] = originalStream;
      logger.level = originalLevel;
      setSocketServer(null);
    }
    const audit = JSON.stringify(await AuditLog.find().lean());
    expect(audit).toMatch(/encounter\.sign/); // the flow was audited…
    expect(audit).not.toMatch(CLINICAL); // …without clinical text
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toMatch(CLINICAL);
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toMatch(CLINICAL);
  });
});
