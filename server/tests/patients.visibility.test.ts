import { AuditLog } from '../src/modules/audit/model.js';
import { Patient } from '../src/modules/patients/model.js';
import { flushAudit } from '../src/services/audit.service.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { createPatient, loginAsPatient } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

/** A patient with every kind of field set. */
async function fullPatient() {
  return createPatient({
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@example.com',
    address: { line1: '12 MG Road', city: 'Bengaluru' },
    insurance: { provider: 'Star Health', policyNumber: 'SH-1' },
    adminNotes: 'Prefers morning slots',
    allergies: [{ substance: 'Penicillin', severity: 'severe', recordedAt: new Date() }],
    chronicConditions: [{ name: 'Hypertension', recordedAt: new Date() }],
  });
}

const get = (me: LoggedIn, id: string) => api().get(`/api/v1/patients/${id}`).set(me.auth);

describe('patient field visibility (spec §2.5)', () => {
  beforeEach(resetDb);

  it('receptionist: demographics, insurance, admin notes and allergies – no chronic conditions', async () => {
    const { id } = await fullPatient();
    const res = await get(await loginAs('receptionist'), id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      fullName: 'Priya Sharma',
      email: 'priya@example.com',
      insurance: { provider: 'Star Health' },
      adminNotes: 'Prefers morning slots',
      allergies: [{ substance: 'Penicillin', severity: 'severe' }],
      portal: { hasAccount: false, email: null, linkStatus: null, lastLoginAt: null },
    });
    expect(res.body.data).not.toHaveProperty('chronicConditions');
    expect(JSON.stringify(res.body)).not.toContain('Hypertension');
  });

  it('admin: demographics, insurance and admin notes – no allergies or chronic conditions', async () => {
    const { id } = await fullPatient();
    const res = await get(await loginAs('admin'), id);
    expect(res.body.data).toMatchObject({ insurance: { provider: 'Star Health' } });
    expect(res.body.data.adminNotes).toBe('Prefers morning slots');
    expect(res.body.data).not.toHaveProperty('allergies');
    expect(res.body.data).not.toHaveProperty('chronicConditions');
    expect(JSON.stringify(res.body)).not.toMatch(/Penicillin|Hypertension/);
  });

  it('patient (own record): everything except admin notes', async () => {
    const me = await loginAsPatient({
      insurance: { provider: 'Star Health' },
      adminNotes: 'Internal note',
      allergies: [{ substance: 'Sulfa drugs', severity: 'moderate' }],
      chronicConditions: [{ name: 'Asthma' }],
    });
    const res = await get(me, me.patientId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      insurance: { provider: 'Star Health' },
      allergies: [{ substance: 'Sulfa drugs' }],
      chronicConditions: [{ name: 'Asthma' }],
    });
    expect(res.body.data).not.toHaveProperty('adminNotes');
    expect(res.body.data).not.toHaveProperty('portal');
    expect(JSON.stringify(res.body)).not.toContain('Internal note');
  });

  it("patients get 404 (not 403) for someone else's record, and the denial is audited", async () => {
    const me = await loginAsPatient();
    const other = await createPatient();
    const res = await get(me, other.id);
    expect(res.status).toBe(404);
    expectErrorShape(res.body, 'NOT_FOUND');
    const [denied] = await auditEntries('access.denied');
    expect(denied?.patient?.toString()).toBe(other.id);
    // Same response for an id that does not exist.
    const missing = await get(me, '0'.repeat(24));
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe(res.body.message);
  });

  it('doctors get 404 until a care relationship exists (Phase 5)', async () => {
    const { id } = await fullPatient();
    const res = await get(await loginAs('doctor'), id);
    expect(res.status).toBe(404);
    expect(await auditEntries('access.denied')).toHaveLength(1);
  });

  it('lab technicians have no patient endpoints yet (403)', async () => {
    const { id } = await fullPatient();
    expect((await get(await loginAs('labtech'), id)).status).toBe(403);
  });

  it('unknown and malformed ids → 404 / 400', async () => {
    const reception = await loginAs('receptionist');
    expect((await get(reception, '0'.repeat(24))).status).toBe(404);
    expectErrorShape((await get(reception, 'nope')).body, 'VALIDATION_ERROR');
  });
});

describe('patient.view audit (debounced, spec §10.4)', () => {
  beforeEach(resetDb);

  it('one entry per user and patient within 5 minutes', async () => {
    const { id, patient } = await fullPatient();
    const reception = await loginAs('receptionist');
    const admin = await loginAs('admin');
    await get(reception, id);
    await get(reception, id);
    await get(reception, id);
    await get(admin, id);
    const entries = await auditEntries('patient.view');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      resource: { type: 'patient', number: patient.mrn },
      outcome: 'success',
    });
    expect(entries[0]?.patient?.toString()).toBe(id);

    // After the window a new entry is written.
    await AuditLog.collection.updateMany({}, { $set: { at: new Date(Date.now() - 6 * 60_000) } });
    await get(reception, id);
    expect(await auditEntries('patient.view')).toHaveLength(3);
  });

  it('another patient is a separate entry; denied reads are not views', async () => {
    const reception = await loginAs('receptionist');
    const a = await createPatient();
    const b = await createPatient();
    await get(reception, a.id);
    await get(reception, b.id);
    await get(await loginAs('doctor'), a.id);
    await flushAudit();
    expect(await auditEntries('patient.view')).toHaveLength(2);
  });
});

describe('PATCH /patients/:id', () => {
  let reception: LoggedIn;
  beforeEach(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
  });
  const patch = (me: LoggedIn, id: string, body: Record<string, unknown>) =>
    api().patch(`/api/v1/patients/${id}`).set(me.auth).send(body);

  it('updates demographics and audits changed field names without identifying values', async () => {
    const { id } = await fullPatient();
    const res = await patch(reception, id, {
      lastName: 'Verma',
      gender: 'other',
      email: 'new@example.com',
      address: { line1: '1 New Road', city: 'Mysuru' },
      adminNotes: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      fullName: 'Priya Verma',
      gender: 'other',
      email: 'new@example.com',
      address: { city: 'Mysuru' },
      adminNotes: null,
    });
    expect((await Patient.findById(id).lean())?.nameKey).toBe('priya verma');

    const [entry] = await auditEntries('patient.update');
    expect([...(entry?.changes?.fields ?? [])].sort()).toEqual(
      ['address', 'adminNotes', 'email', 'gender', 'lastName'].sort(),
    );
    expect(entry?.changes?.after).toMatchObject({ gender: 'other', lastName: '[REDACTED]' });
    expect(JSON.stringify(entry)).not.toMatch(/Verma|Mysuru|new@example|morning/);
  });

  it('no changes → no audit entry', async () => {
    const { id } = await fullPatient();
    expect((await patch(reception, id, { firstName: 'Priya' })).status).toBe(200);
    expect(await auditEntries('patient.update')).toHaveLength(0);
  });

  it('receptionists edit allergies: unchanged entries keep who recorded them', async () => {
    const { id } = await fullPatient();
    const before = (await get(reception, id)).body.data.allergies[0];
    const res = await patch(reception, id, {
      allergies: [
        { id: before.id, substance: 'Penicillin', severity: 'severe' },
        { substance: 'Peanuts', reaction: 'Swelling', severity: 'moderate' },
      ],
    });
    expect(res.status).toBe(200);
    const [kept, added] = res.body.data.allergies;
    expect(kept).toEqual(before);
    expect(added).toMatchObject({ substance: 'Peanuts', recordedBy: reception.user.id });
    const [entry] = await auditEntries('patient.update');
    expect(entry?.changes).toMatchObject({
      fields: ['allergies'],
      after: { allergies: '[REDACTED]' },
    });
  });

  it('admins cannot change allergies (403) but can edit demographics', async () => {
    const { id } = await fullPatient();
    const admin = await loginAs('admin');
    const res = await patch(admin, id, { allergies: [] });
    expect(res.status).toBe(403);
    expect((await patch(admin, id, { adminNotes: 'Admin note' })).status).toBe(200);
  });

  it('cannot set chronic conditions or the MRN', async () => {
    const { id } = await fullPatient();
    const res = await patch(reception, id, { chronicConditions: [], mrn: 'MRN-999999' });
    expectErrorShape(res.body, 'VALIDATION_ERROR');
  });

  it('changing phone or DOB re-runs the duplicate check (409 unless force + reason)', async () => {
    const other = await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
    const { id } = await createPatient({ dateOfBirth: '1990-05-17' });
    const res = await patch(reception, id, { phone: '98765 43210' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.matches).toEqual([
      expect.objectContaining({ id: other.id, matchedOn: ['phone_dob'] }),
    ]);
    const forced = await patch(reception, id, {
      phone: '98765 43210',
      force: true,
      reason: 'Shares the family phone number',
    });
    expect(forced.status).toBe(200);
    const [override] = await auditEntries('patient.update_duplicate_override');
    expect(override?.metadata).toMatchObject({ reason: 'Shares the family phone number' });
    // Editing other fields of a (now) duplicate does not trigger the check again.
    expect((await patch(reception, id, { preferredLanguage: 'hi' })).status).toBe(200);
  });

  it('doctors, lab techs and patients cannot use it (403)', async () => {
    const { id } = await fullPatient();
    for (const role of ['doctor', 'labtech', 'patient'] as const) {
      expect((await patch(await loginAs(role), id, { adminNotes: 'x' })).status).toBe(403);
    }
  });
});

describe('PATCH /patients/:id/clinical-profile', () => {
  beforeEach(resetDb);

  it('doctors get 404 until care relationships exist; the denial is audited', async () => {
    const { id } = await fullPatient();
    const doctor = await loginAs('doctor');
    const res = await api()
      .patch(`/api/v1/patients/${id}/clinical-profile`)
      .set(doctor.auth)
      .send({ chronicConditions: [{ name: 'Asthma' }] });
    expect(res.status).toBe(404);
    const [denied] = await auditEntries('access.denied');
    expect(denied?.metadata).toMatchObject({ scope: 'clinical' });
    expect((await Patient.findById(id).lean())?.chronicConditions).toHaveLength(1);
  });

  it('other roles → 403', async () => {
    const { id } = await fullPatient();
    for (const role of ['admin', 'receptionist', 'labtech', 'patient'] as const) {
      const res = await api()
        .patch(`/api/v1/patients/${id}/clinical-profile`)
        .set((await loginAs(role)).auth)
        .send({ chronicConditions: [] });
      expect(res.status, role).toBe(403);
    }
  });
});

describe('POST /patients/:id/deactivate and /activate', () => {
  beforeEach(resetDb);

  it('admin deactivates and reactivates with a reason; both audited', async () => {
    const { id } = await fullPatient();
    const admin = await loginAs('admin');
    const off = await api()
      .post(`/api/v1/patients/${id}/deactivate`)
      .set(admin.auth)
      .send({ reason: 'Duplicate record' });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    const again = await api()
      .post(`/api/v1/patients/${id}/deactivate`)
      .set(admin.auth)
      .send({ reason: 'Duplicate record' });
    expect(again.status).toBe(409);
    expectErrorShape(again.body, 'INVALID_STATUS_TRANSITION');

    const reception = await loginAs('receptionist');
    const listed = await api().get('/api/v1/patients').set(reception.auth);
    expect(listed.body.data).toEqual([]);

    const on = await api()
      .post(`/api/v1/patients/${id}/activate`)
      .set(admin.auth)
      .send({ reason: 'Recorded in error' });
    expect(on.body.data.isActive).toBe(true);
    const [deactivated] = await auditEntries('patient.deactivate');
    expect(deactivated?.metadata).toEqual({ reason: 'Duplicate record' });
    expect(await auditEntries('patient.activate')).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const { id } = await fullPatient();
    const res = await api()
      .post(`/api/v1/patients/${id}/deactivate`)
      .set((await loginAs('admin')).auth)
      .send({});
    expectErrorShape(res.body, 'VALIDATION_ERROR');
  });
});
