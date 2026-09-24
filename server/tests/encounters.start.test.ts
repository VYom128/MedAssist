import { Appointment } from '../src/modules/appointments/model.js';
import { Counter } from '../src/modules/counters/model.js';
import { ensureEncounterDraft } from '../src/modules/encounters/draft.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { withTransaction } from '../src/utils/transaction.js';
import { auditEntries, loginAs, resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  checkedInToday,
  loginAsDoctor,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** The draft encounter is created with the consultation start (spec §4.7 step 1, §5.1). */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init()]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => emails.restore());

const post = (path: string, auth: { Authorization: string }) =>
  api().post(`/api/v1${path}`).set(auth);

describe('POST /appointments/:id/start', () => {
  it('creates the draft encounter in the same step and returns encounterId', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId, patientId, startAt } = await checkedInToday(doctor.id);
    const res = await post(`/appointments/${appointmentId}/start`, doctor.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: appointmentId, status: 'in_consultation' });
    const encounterId = res.body.data.encounterId as string;

    const e = await Encounter.findById(encounterId).lean();
    expect(e).toMatchObject({ status: 'draft', version: 1, __v: 0 });
    expect(e?.encounterNumber).toMatch(/^ENC-\d{4}-000001$/);
    expect(e?.appointment.toString()).toBe(appointmentId);
    expect(e?.patient.toString()).toBe(patientId);
    expect(e?.doctor.toString()).toBe(doctor.id);
    expect(e?.visitAt.toISOString()).toBe(startAt.toISOString());

    const [created] = await auditEntries('encounter.create');
    expect(created?.resource).toMatchObject({ type: 'encounter', number: e?.encounterNumber });
    expect(created?.patient?.toString()).toBe(patientId);
    expect(await auditEntries('appointment.start')).toHaveLength(1);
  });

  it('10 parallel starts of one appointment → one 200 and exactly one encounter', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId } = await checkedInToday(doctor.id);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(`/appointments/${appointmentId}/start`, doctor.auth)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
    expect(await Encounter.countDocuments({ appointment: appointmentId })).toBe(1);
    expect(await auditEntries('encounter.create')).toHaveLength(1);
    // The number sequence was used once: the losers' transactions took none.
    const [counter] = await Counter.find({ _id: /^encounter:/ }).lean();
    expect(counter?.seq).toBe(1);
  });

  it('is atomic: if the note cannot be created, the appointment stays checked in', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId } = await checkedInToday(doctor.id);
    const spy = vi.spyOn(Encounter, 'create').mockRejectedValueOnce(new Error('disk full'));
    try {
      const res = await post(`/appointments/${appointmentId}/start`, doctor.auth);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await Appointment.findById(appointmentId).lean())?.status).toBe('checked_in');
    expect(await Encounter.countDocuments()).toBe(0);
    // And it can be started normally afterwards.
    expect((await post(`/appointments/${appointmentId}/start`, doctor.auth)).status).toBe(200);
    expect(await Encounter.countDocuments({ appointment: appointmentId })).toBe(1);
  });
});

describe('POST /queue/call-next', () => {
  it('returns encounterId for the called patient', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId } = await checkedInToday(doctor.id);
    const res = await post('/queue/call-next', doctor.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(appointmentId);
    const e = await Encounter.findOne({ appointment: appointmentId }).lean();
    expect(res.body.data.encounterId).toBe(e?._id.toString());
  });

  it('parallel call-next clicks with several patients waiting → one encounter', async () => {
    const doctor = await loginAsDoctor();
    for (let i = 0; i < 3; i += 1) await checkedInToday(doctor.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => post('/queue/call-next', doctor.auth)),
    );
    expect(results.filter((r) => r.status === 200 && r.body.data)).toHaveLength(1);
    expect(await Encounter.countDocuments()).toBe(1);
    expect(await Appointment.countDocuments({ status: 'in_consultation' })).toBe(1);
  });

  it('nobody waiting → null and no encounter', async () => {
    const doctor = await loginAsDoctor();
    const res = await post('/queue/call-next', doctor.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(await Encounter.countDocuments()).toBe(0);
  });
});

describe('ensureEncounterDraft', () => {
  it('is idempotent: a second call returns the same note and takes no number', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId } = await checkedInToday(doctor.id);
    const appt = (await Appointment.findById(appointmentId).lean())!;
    const ensure = () =>
      withTransaction((session) =>
        ensureEncounterDraft(appt, { by: doctor.id, year: 2026, session }),
      );
    const first = await ensure();
    const second = await ensure();
    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    expect(first.encounterNumber).toBe('ENC-2026-000001');
    expect((await Counter.findById('encounter:2026').lean())?.seq).toBe(1);
  });

  it('the unique index on appointment is the last guard', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId } = await checkedInToday(doctor.id);
    const appt = (await Appointment.findById(appointmentId).lean())!;
    await withTransaction((session) =>
      ensureEncounterDraft(appt, { by: doctor.id, year: 2026, session }),
    );
    await expect(
      Encounter.create({
        encounterNumber: 'ENC-2026-999999',
        appointment: appointmentId,
        patient: appt.patient,
        doctor: appt.doctor,
        visitAt: appt.startAt,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('GET /appointments/:id/encounter', () => {
  it('returns the note of the doctor’s own appointment', async () => {
    const { doctor, appointmentId, encounterId } = await startedConsultation();
    const res = await api().get(`/api/v1/appointments/${appointmentId}/encounter`).set(doctor.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: encounterId,
      appointmentId,
      status: 'draft',
      revision: 0,
      version: 1,
      chiefComplaint: null,
      diagnoses: [],
    });
    expect(await auditEntries('encounter.view')).toHaveLength(1);
  });

  it("another doctor's appointment → 404 (audited)", async () => {
    const { appointmentId } = await startedConsultation();
    const other = await loginAsDoctor();
    const res = await api().get(`/api/v1/appointments/${appointmentId}/encounter`).set(other.auth);
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
    expect(await auditEntries('access.denied')).toHaveLength(1);
  });

  it('no note yet → 404; staff → 403', async () => {
    const doctor = await loginAsDoctor();
    const { appointmentId } = await checkedInToday(doctor.id);
    const res = await api().get(`/api/v1/appointments/${appointmentId}/encounter`).set(doctor.auth);
    expect(res.status).toBe(404);
    for (const role of ['admin', 'receptionist', 'patient', 'labtech'] as const) {
      const staff = await loginAs(role);
      const r = await api().get(`/api/v1/appointments/${appointmentId}/encounter`).set(staff.auth);
      expect(r.status).toBe(403);
    }
  });
});
