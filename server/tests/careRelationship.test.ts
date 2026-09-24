import { Types } from 'mongoose';
import { Appointment } from '../src/modules/appointments/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { createPatient, insertAppointment, loginAsDoctor } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/**
 * Doctors and the care relationship (spec §2.3, §2.4, §7.7): a doctor reads a patient only
 * with a non-cancelled appointment with them; anything else → 404 with `access.denied`.
 */

let doctor: LoggedIn & { id: string };
beforeEach(async () => {
  await resetDb();
  doctor = await loginAsDoctor();
});

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
let minute = 0;
const visit = (patient: string, startAt: Date, status = 'completed', doctorId = doctor.id) => {
  minute += 1;
  return insertAppointment({
    patient,
    doctor: doctorId,
    startAt: new Date(startAt.getTime() + minute * 60_000),
    status,
    isSlotActive: false,
  });
};
const get = (path: string, who: LoggedIn = doctor) => api().get(`/api/v1${path}`).set(who.auth);

describe('GET /patients/:id as a doctor', () => {
  it('with an appointment: the doctor view (no insurance or admin notes); audited patient.view', async () => {
    const { id } = await createPatient({
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
      chronicConditions: [{ name: 'Hypertension' }],
      insurance: { provider: 'Star Health', policyNumber: 'SH-1' },
      adminNotes: 'Prefers mornings',
    });
    await visit(id, daysAgo(30));
    const res = await get(`/patients/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id,
      allergies: [expect.objectContaining({ substance: 'Penicillin' })],
      chronicConditions: [expect.objectContaining({ name: 'Hypertension' })],
    });
    expect(res.body.data).not.toHaveProperty('insurance');
    expect(res.body.data).not.toHaveProperty('adminNotes');
    expect(res.body.data).not.toHaveProperty('portal');
    expect((await auditEntries('patient.view'))[0]?.patient?.toString()).toBe(id);
  });

  it('a future appointment is enough (e.g. reviewing before the visit)', async () => {
    const { id } = await createPatient();
    await visit(id, new Date(Date.now() + 3 * 86_400_000), 'scheduled');
    expect((await get(`/patients/${id}`)).status).toBe(200);
  });

  it('only cancelled appointments → 404, audited access.denied', async () => {
    const { id } = await createPatient();
    await visit(id, daysAgo(2), 'cancelled');
    const res = await get(`/patients/${id}`);
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
    const [denied] = await auditEntries('access.denied');
    expect(denied).toMatchObject({ outcome: 'denied', metadata: { scope: 'demographics' } });
    expect(denied?.patient?.toString()).toBe(id);
  });

  it("another doctor's patient → 404, same response as a missing id", async () => {
    const { id } = await createPatient();
    const other = await loginAsDoctor();
    await visit(id, daysAgo(2), 'completed', other.id);
    const res = await get(`/patients/${id}`);
    const missing = await get(`/patients/${new Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(res.body.message).toBe(missing.body.message);
    expect((await get(`/patients/${id}`, other)).status).toBe(200);
  });

  it('doctors cannot use the front-desk patient endpoints (403)', async () => {
    const { id } = await createPatient();
    await visit(id, daysAgo(2));
    const patch = await api()
      .patch(`/api/v1/patients/${id}`)
      .set(doctor.auth)
      .send({ adminNotes: 'x' });
    expect(patch.status).toBe(403);
    expect(
      (await get('/patients/check-duplicate?phone=9876543210&dateOfBirth=1985-06-15')).status,
    ).toBe(403);
  });
});

describe('GET /patients?scope=mine', () => {
  it('lists related patients, most recently seen first, with the last visit', async () => {
    const recent = await createPatient({ firstName: 'Asha', lastName: 'Rao' });
    const older = await createPatient({ firstName: 'Bala', lastName: 'Iyer' });
    const upcomingOnly = await createPatient({ firstName: 'Chitra', lastName: 'Nair' });
    const cancelledOnly = await createPatient({ firstName: 'Dev', lastName: 'Shah' });
    const notMine = await createPatient({ firstName: 'Esha', lastName: 'Gill' });

    await visit(recent.id, daysAgo(40));
    const last = await visit(recent.id, daysAgo(3));
    await visit(recent.id, new Date(Date.now() + 86_400_000), 'scheduled');
    const olderVisit = await visit(older.id, daysAgo(20), 'completed');
    await visit(older.id, daysAgo(10), 'no_show');
    await visit(upcomingOnly.id, new Date(Date.now() + 2 * 86_400_000), 'scheduled');
    await visit(cancelledOnly.id, daysAgo(1), 'cancelled');
    await visit(notMine.id, daysAgo(1), 'completed', (await loginAsDoctor()).id);

    const res = await get('/patients?scope=mine');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([
      recent.id,
      older.id,
      upcomingOnly.id,
    ]);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    const [first, second, third] = res.body.data;
    expect(res.body.data.map((p: { hasAllergies: boolean }) => p.hasAllergies)).toEqual([
      false,
      false,
      false,
    ]);
    expect(first).toMatchObject({ fullName: 'Asha Rao', mrn: expect.stringMatching(/^MRN-/) });
    expect(first.lastVisitAt).toBe(last.startAt.toISOString());
    expect(second.lastVisitAt).toBe(olderVisit.startAt.toISOString()); // the no-show is no visit
    expect(third.lastVisitAt).toBeNull();
    expect(third.lastAppointmentAt).toEqual(expect.any(String));
    // List items only: nothing clinical.
    expect(JSON.stringify(res.body.data)).not.toMatch(/allergies|chronicConditions|insurance/);
    // Doctors get their own patients with or without the scope.
    expect((await get('/patients')).body.meta.total).toBe(3);
  });

  it('flags patients with allergies (no allergy details in the list)', async () => {
    const allergic = await createPatient({ allergies: [{ substance: 'Sulfa', severity: 'mild' }] });
    await visit(allergic.id, daysAgo(1));
    const res = await get('/patients?scope=mine');
    expect(res.body.data[0]).toMatchObject({ id: allergic.id, hasAllergies: true });
    expect(JSON.stringify(res.body.data)).not.toContain('Sulfa');
  });

  it('searches (q) and paginates within the related patients only', async () => {
    const ids: string[] = [];
    for (const [first, lastName] of [
      ['Amit', 'Patel'],
      ['Amit', 'Shah'],
      ['Anil', 'Kumar'],
    ] as const) {
      const p = await createPatient({ firstName: first, lastName });
      await visit(p.id, daysAgo(ids.length + 1));
      ids.push(p.id);
    }
    await createPatient({ firstName: 'Amit', lastName: 'Stranger' }); // no relationship

    const amit = await get('/patients?scope=mine&q=amit');
    expect(amit.body.data.map((p: { id: string }) => p.id)).toEqual([ids[0], ids[1]]);
    const page2 = await get('/patients?scope=mine&limit=2&page=2');
    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(page2.body.data.map((p: { id: string }) => p.id)).toEqual([ids[2]]);
    const byMrn = await get(
      `/patients?scope=mine&q=${(await Patient.findById(ids[2]).lean())!.mrn}`,
    );
    expect(byMrn.body.data.map((p: { id: string }) => p.id)).toEqual([ids[2]]);
  });

  it('leaves out inactive patients; empty for a doctor without patients', async () => {
    const p = await createPatient({ isActive: false });
    await visit(p.id, daysAgo(1));
    expect((await get('/patients?scope=mine')).body).toMatchObject({
      data: [],
      meta: { total: 0 },
    });
    expect((await get('/patients?scope=everyone')).status).toBe(400);
  });

  it('one aggregation, not a query per patient', async () => {
    for (let i = 0; i < 5; i += 1) await visit((await createPatient()).id, daysAgo(i + 1));
    const spy = vi.spyOn(Appointment, 'aggregate');
    const exists = vi.spyOn(Appointment, 'exists');
    try {
      expect((await get('/patients?scope=mine')).body.meta.total).toBe(5);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(exists).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      exists.mockRestore();
    }
  });
});

describe('who reads clinical records', () => {
  it('admins and receptionists never get encounter endpoints (403)', async () => {
    for (const role of ['admin', 'receptionist'] as const) {
      const who = await loginAs(role);
      expect((await get('/encounters', who)).status).toBe(403);
      expect((await get(`/encounters/${new Types.ObjectId().toString()}`, who)).status).toBe(403);
    }
  });
});
