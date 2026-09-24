import { Appointment } from '../src/modules/appointments/model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { addDaysToDate, clinicToday } from '../src/utils/dates.js';
import { getSettings } from '../src/modules/settings/service.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';
import {
  createPatient,
  insertAppointment,
  loginAsDoctor,
  startedConsultation,
  useMiddayClinicZone,
} from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** GET/PATCH /encounters (spec §7.10, §8.5): reads, lists and autosave of drafts. */

let emails: ReturnType<typeof captureEmails>;
beforeEach(async () => {
  await resetDb();
  await Promise.all([Appointment.init(), Encounter.init()]);
  await useMiddayClinicZone();
  emails = captureEmails();
});
afterEach(() => {
  emails.restore();
  vi.useRealTimers();
});

const get = (path: string, who: LoggedIn) => api().get(`/api/v1${path}`).set(who.auth);
const patch = (id: string, who: LoggedIn, body: object) =>
  api().patch(`/api/v1/encounters/${id}`).set(who.auth).send(body);

/** Marks a note signed directly in the collection (signing is Phase 5 step 2). */
const markSigned = (id: string) =>
  Encounter.collection.updateOne(
    { _id: new Encounter.base.Types.ObjectId(id) },
    { $set: { status: 'signed', signedAt: new Date() } },
  );

/** Gives `doctorId` a care relationship with `patientId` (a past completed appointment). */
const relate = (doctorId: string, patientId: string) =>
  insertAppointment({
    patient: patientId,
    doctor: doctorId,
    startAt: new Date(Date.now() - 20 * 86_400_000 + Math.floor(Math.random() * 1e6)),
    status: 'completed',
    isSlotActive: false,
  });

describe('GET /encounters/:id', () => {
  it('the own doctor reads the draft; audited encounter.view, debounced', async () => {
    const { doctor, encounterId, patientId } = await startedConsultation();
    const first = await get(`/encounters/${encounterId}`, doctor);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ id: encounterId, status: 'draft', revision: 0 });
    expect(first.body.data.patient).toMatchObject({ id: patientId });
    expect((await get(`/encounters/${encounterId}`, doctor)).status).toBe(200);
    const views = await auditEntries('encounter.view');
    expect(views).toHaveLength(1);
    expect(views[0]?.patient?.toString()).toBe(patientId);
  });

  it('another doctor: a draft is private (404) even with a care relationship; a signed note needs one', async () => {
    const { encounterId, patientId } = await startedConsultation();
    const related = await loginAsDoctor();
    await relate(related.id, patientId);
    const stranger = await loginAsDoctor();

    expect((await get(`/encounters/${encounterId}`, related)).status).toBe(404);
    await markSigned(encounterId);
    expect((await get(`/encounters/${encounterId}`, related)).status).toBe(200);
    const denied = await get(`/encounters/${encounterId}`, stranger);
    expect(denied.status).toBe(404);
    expectErrorShape(denied.body, 'NOT_FOUND');
    expect((await auditEntries('access.denied')).length).toBeGreaterThanOrEqual(2);
  });

  it('only cancelled appointments with the patient → no relationship → 404', async () => {
    const { encounterId, patientId } = await startedConsultation();
    await markSigned(encounterId);
    const doctor = await loginAsDoctor();
    await insertAppointment({
      patient: patientId,
      doctor: doctor.id,
      startAt: new Date(Date.now() + 5 * 86_400_000),
      status: 'cancelled',
      isSlotActive: false,
    });
    expect((await get(`/encounters/${encounterId}`, doctor)).status).toBe(404);
  });

  it('admins, receptionists, lab techs and patients never read encounters (403)', async () => {
    const { encounterId } = await startedConsultation();
    await markSigned(encounterId);
    for (const role of ['admin', 'receptionist', 'labtech', 'patient'] as const) {
      const who = await loginAs(role);
      expect((await get(`/encounters/${encounterId}`, who)).status).toBe(403);
      expect((await get('/encounters', who)).status).toBe(403);
    }
  });

  it('unknown id → 404; malformed → 400', async () => {
    const doctor = await loginAsDoctor();
    expect((await get(`/encounters/${'0'.repeat(24)}`, doctor)).status).toBe(404);
    expectErrorShape((await get('/encounters/nope', doctor)).body, 'VALIDATION_ERROR');
  });
});

describe('GET /encounters', () => {
  it('own notes and signed notes of related patients; no clinical text in list items', async () => {
    const mine = await startedConsultation();
    await patch(mine.encounterId, mine.doctor, { expectedVersion: 0, chiefComplaint: 'Cough' });

    // A colleague's notes for the same patient: one signed (visible), one draft (hidden).
    const colleague = await loginAsDoctor();
    const signed = await startedConsultation(colleague, { patientId: mine.patientId });
    await markSigned(signed.encounterId);
    await Appointment.updateOne(
      { _id: signed.appointmentId },
      { $set: { status: 'completed', isSlotActive: true } },
    );
    const draft = await startedConsultation(colleague, { patientId: mine.patientId });
    await Appointment.updateOne(
      { _id: draft.appointmentId },
      { $set: { status: 'completed', isSlotActive: true } },
    );
    // A signed note of an unrelated patient.
    const unrelated = await startedConsultation(colleague);
    await markSigned(unrelated.encounterId);

    const res = await get('/encounters', mine.doctor);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((e: { id: string }) => e.id).sort();
    expect(ids).toEqual([mine.encounterId, signed.encounterId].sort());
    expect(ids).not.toContain(draft.encounterId);
    expect(res.body.meta).toMatchObject({ total: 2 });
    expect(JSON.stringify(res.body.data)).not.toMatch(/Cough|chiefComplaint|diagnoses|vitals/);
    expect(await auditEntries('encounter.view')).toHaveLength(0);

    const drafts = await get('/encounters?status=draft', mine.doctor);
    expect(drafts.body.data.map((e: { id: string }) => e.id)).toEqual([mine.encounterId]);
  });

  it('?patient= gives that patient’s history, 404 without a relationship', async () => {
    const mine = await startedConsultation();
    const other = await createPatient();
    const history = await get(`/encounters?patient=${mine.patientId}`, mine.doctor);
    expect(history.body.data.map((e: { id: string }) => e.id)).toEqual([mine.encounterId]);
    const denied = await get(`/encounters?patient=${other.id}`, mine.doctor);
    expect(denied.status).toBe(404);
  });

  it('filters by visit date (clinic days) and paginates', async () => {
    const mine = await startedConsultation();
    const { timezone } = await getSettings();
    const today = clinicToday(timezone);
    const tomorrow = addDaysToDate(today, 1);
    expect((await get(`/encounters?from=${today}&to=${today}`, mine.doctor)).body.meta.total).toBe(
      1,
    );
    expect((await get(`/encounters?from=${tomorrow}`, mine.doctor)).body.meta.total).toBe(0);
    expect((await get(`/encounters?limit=1&page=2`, mine.doctor)).body.data).toEqual([]);
    const bad = await get(`/encounters?from=${tomorrow}&to=${today}`, mine.doctor);
    expectErrorShape(bad.body, 'VALIDATION_ERROR');
  });
});

describe('PATCH /encounters/:id (autosave)', () => {
  it('saves partial changes and returns the new revision', async () => {
    const { doctor, encounterId } = await startedConsultation();
    const res = await patch(encounterId, doctor, {
      expectedVersion: 0,
      chiefComplaint: '  Fever for 3 days  ',
      diagnoses: [
        {
          description: 'Acute pharyngitis',
          icd10Code: 'j02.9',
          type: 'provisional',
          isPrimary: true,
        },
        { description: 'Dehydration' },
      ],
      followUp: { required: true, afterDays: 5, instructions: 'Review if not better' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      revision: 1,
      chiefComplaint: 'Fever for 3 days',
      diagnoses: [
        {
          description: 'Acute pharyngitis',
          icd10Code: 'J02.9',
          type: 'provisional',
          isPrimary: true,
        },
        { description: 'Dehydration', icd10Code: null, type: 'provisional', isPrimary: false },
      ],
      followUp: { required: true, afterDays: 5, date: null, instructions: 'Review if not better' },
    });
    const next = await patch(encounterId, doctor, { expectedVersion: 1, chiefComplaint: '' });
    expect(next.body.data).toMatchObject({ revision: 2, chiefComplaint: null });
    expect(next.body.data.diagnoses).toHaveLength(2); // untouched fields stay
  });

  it('computes BMI on the server whenever weight or height change', async () => {
    const { doctor, encounterId } = await startedConsultation();
    const a = await patch(encounterId, doctor, {
      expectedVersion: 0,
      vitals: { weightKg: 70, heightCm: 175, pulse: 88 },
    });
    expect(a.body.data.vitals).toMatchObject({
      weightKg: 70,
      heightCm: 175,
      pulse: 88,
      bmi: 22.9,
      recordedBy: doctor.id,
    });
    const b = await patch(encounterId, doctor, { expectedVersion: 1, vitals: { heightCm: 160 } });
    expect(b.body.data.vitals).toMatchObject({ weightKg: 70, heightCm: 160, pulse: 88, bmi: 27.3 });
    const c = await patch(encounterId, doctor, { expectedVersion: 2, vitals: { weightKg: null } });
    expect(c.body.data.vitals).toMatchObject({ weightKg: null, heightCm: 160, bmi: null });
    // BMI cannot be sent.
    const d = await patch(encounterId, doctor, { expectedVersion: 3, vitals: { bmi: 40 } });
    expectErrorShape(d.body, 'VALIDATION_ERROR');
  });

  it('a stale expectedVersion → 409 CONFLICT ("changed in another tab")', async () => {
    const { doctor, encounterId } = await startedConsultation();
    expect((await patch(encounterId, doctor, { expectedVersion: 0, plan: 'Tab A' })).status).toBe(
      200,
    );
    const stale = await patch(encounterId, doctor, { expectedVersion: 0, plan: 'Tab B' });
    expect(stale.status).toBe(409);
    const body = expectErrorShape(stale.body, 'CONFLICT');
    expect(body.error.details).toEqual({ currentRevision: 1 });
    expect(body.message).toMatch(/another tab/);
    expect((await Encounter.findById(encounterId).lean())?.plan).toBe('Tab A');
  });

  it('parallel saves with the same expectedVersion: exactly one wins', async () => {
    const { doctor, encounterId } = await startedConsultation();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => patch(encounterId, doctor, { expectedVersion: 0, plan: `P${n}` })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect((await Encounter.findById(encounterId).lean())?.__v).toBe(1);
  });

  it('another doctor → 404 (audited); staff → 403', async () => {
    const { encounterId, patientId } = await startedConsultation();
    const other = await loginAsDoctor();
    await relate(other.id, patientId); // even with a relationship: only the own doctor writes
    const res = await patch(encounterId, other, { expectedVersion: 0, plan: 'x' });
    expect(res.status).toBe(404);
    expect(await auditEntries('access.denied')).toHaveLength(1);
    for (const role of ['admin', 'receptionist'] as const) {
      expect((await patch(encounterId, await loginAs(role), { expectedVersion: 0 })).status).toBe(
        403,
      );
    }
  });

  it('documentation window: open in consultation and up to 72 h after completion, then 422', async () => {
    const { doctor, encounterId, appointmentId } = await startedConsultation();
    const complete = (hoursAgo: number) =>
      Appointment.updateOne(
        { _id: appointmentId },
        {
          $set: {
            status: 'completed',
            isSlotActive: true,
            'queue.completedAt': new Date(Date.now() - hoursAgo * 3_600_000),
          },
        },
      );
    await complete(71);
    const within = await patch(encounterId, doctor, { expectedVersion: 0, plan: 'Late note' });
    expect(within.status).toBe(200);
    await complete(73);
    const closed = await patch(encounterId, doctor, { expectedVersion: 1, plan: 'Too late' });
    expect(closed.status).toBe(422);
    expectErrorShape(closed.body, 'DOCUMENTATION_WINDOW_CLOSED');
    expect((await Encounter.findById(encounterId).lean())?.plan).toBe('Late note');
  });

  it('a signed note → 409 RECORD_LOCKED', async () => {
    const { doctor, encounterId } = await startedConsultation();
    await markSigned(encounterId);
    const res = await patch(encounterId, doctor, { expectedVersion: 0, plan: 'x' });
    expect(res.status).toBe(409);
    expectErrorShape(res.body, 'RECORD_LOCKED');
  });

  describe('validation', () => {
    const cases: [string, object, string][] = [
      ['no expectedVersion', { plan: 'x' }, 'body.expectedVersion'],
      ['nothing to update', {}, 'body'],
      ['unknown field', { status: 'signed' }, 'body'],
      ['pulse out of range', { vitals: { pulse: 400 } }, 'body.vitals.pulse'],
      ['SpO2 out of range', { vitals: { spo2: 49 } }, 'body.vitals.spo2'],
      ['temperature out of range', { vitals: { temperatureC: 46 } }, 'body.vitals.temperatureC'],
      ['weight out of range', { vitals: { weightKg: 0.4 } }, 'body.vitals.weightKg'],
      ['chief complaint too long', { chiefComplaint: 'x'.repeat(1001) }, 'body.chiefComplaint'],
      ['examination too long', { examination: 'x'.repeat(5001) }, 'body.examination'],
      [
        'diagnosis without description',
        { diagnoses: [{ description: ' ' }] },
        'body.diagnoses.0.description',
      ],
      [
        'bad diagnosis type',
        { diagnoses: [{ description: 'A', type: 'maybe' }] },
        'body.diagnoses.0.type',
      ],
      [
        'bad ICD-10 code',
        { diagnoses: [{ description: 'A', icd10Code: '123' }] },
        'body.diagnoses.0.icd10Code',
      ],
      [
        'two primary diagnoses',
        {
          diagnoses: [
            { description: 'A', isPrimary: true },
            { description: 'B', isPrimary: true },
          ],
        },
        'body.diagnoses',
      ],
      [
        'follow-up days and date',
        { followUp: { required: true, afterDays: 5, date: '2099-01-01' } },
        'body.followUp.date',
      ],
      [
        'follow-up in the past',
        { followUp: { required: true, date: '2020-01-01' } },
        'body.followUp.date',
      ],
      [
        'follow-up days out of range',
        { followUp: { required: true, afterDays: 366 } },
        'body.followUp.afterDays',
      ],
      [
        'follow-up when not needed',
        { followUp: { required: false, afterDays: 7 } },
        'body.followUp.required',
      ],
    ];
    for (const [label, body, field] of cases) {
      it(`${label} → 400 (${field})`, async () => {
        const { doctor, encounterId } = await startedConsultation();
        const sent = await patch(
          encounterId,
          doctor,
          label === 'no expectedVersion' ? body : { expectedVersion: 0, ...body },
        );
        expect(sent.status).toBe(400);
        const error = expectErrorShape(sent.body, 'VALIDATION_ERROR');
        expect(error.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
      });
    }

    it('a future follow-up date is accepted and returned as a clinic date', async () => {
      const { doctor, encounterId } = await startedConsultation();
      const { timezone } = await getSettings();
      const date = addDaysToDate(clinicToday(timezone), 14);
      const res = await patch(encounterId, doctor, {
        expectedVersion: 0,
        followUp: { required: true, date },
      });
      expect(res.body.data.followUp).toMatchObject({ required: true, date, afterDays: null });
    });
  });

  describe('audit', () => {
    it('names the changed fields only – never clinical text – debounced per 5 minutes', async () => {
      const { doctor, encounterId, patientId } = await startedConsultation();
      await patch(encounterId, doctor, {
        expectedVersion: 0,
        chiefComplaint: 'Chest pain radiating to left arm',
        vitals: { bpSystolic: 150, bpDiastolic: 95 },
        diagnoses: [{ description: 'Suspected angina', icd10Code: 'I20.9' }],
      });
      await patch(encounterId, doctor, { expectedVersion: 1, plan: 'ECG and troponin' });
      const entries = await auditEntries('encounter.update');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.changes?.fields).toEqual(['chiefComplaint', 'diagnoses', 'vitals']);
      expect(entries[0]?.patient?.toString()).toBe(patientId);
      const stored = JSON.stringify(entries);
      // Words only: ids and hashes are hex, so digits like "150" could appear by chance.
      expect(stored).not.toMatch(/Chest|angina|I20\.9|ECG|troponin/);
      // Field names only – no before/after values (the note's values stay in the note).
      expect(entries[0]?.changes).toEqual({ fields: ['chiefComplaint', 'diagnoses', 'vitals'] });

      // 6 minutes later the next save is audited again.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 6 * 60_000);
      await patch(encounterId, doctor, { expectedVersion: 2, adviceToPatient: 'Rest' });
      const later = await auditEntries('encounter.update');
      expect(later).toHaveLength(2);
      expect(later[1]?.changes?.fields).toEqual(['adviceToPatient']);
    });

    it('another doctor’s autosave of their own note is audited separately', async () => {
      const a = await startedConsultation();
      const b = await startedConsultation();
      await patch(a.encounterId, a.doctor, { expectedVersion: 0, plan: 'x' });
      await patch(b.encounterId, b.doctor, { expectedVersion: 0, plan: 'y' });
      expect(await auditEntries('encounter.update')).toHaveLength(2);
    });
  });
});
