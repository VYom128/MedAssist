import { Patient } from '../src/modules/patients/model.js';
import { auditEntries, loginAs, resetDb, type LoggedIn } from './helpers/auth.js';
import { createPatient } from './helpers/fixtures.js';
import { api, expectErrorShape } from './helpers/testApp.js';

const valid = {
  firstName: 'Priya',
  lastName: 'Sharma',
  dateOfBirth: '1990-05-17',
  gender: 'female',
  phone: '098765 43210',
  email: 'Priya@Example.com',
  address: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
  emergencyContact: { name: 'Ravi Sharma', relation: 'Husband', phone: '9876500000' },
  consent: { dataProcessing: true },
};

const create = (me: LoggedIn, body: Record<string, unknown>) =>
  api().post('/api/v1/patients').set(me.auth).send(body);

describe('POST /patients', () => {
  let reception: LoggedIn;
  let admin: LoggedIn;
  beforeEach(async () => {
    await resetDb();
    reception = await loginAs('receptionist');
    admin = await loginAs('admin');
  });

  it('registers a patient with an MRN, E.164 phone and consent, and audits it', async () => {
    const res = await create(reception, {
      ...valid,
      allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'severe' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      mrn: 'MRN-000001',
      fullName: 'Priya Sharma',
      phone: '+919876543210',
      email: 'priya@example.com',
      dateOfBirth: '1990-05-17',
      emergencyContact: { phone: '+919876500000' },
      consent: { dataProcessing: { given: true }, aiExplanations: { given: true } },
      allergies: [{ substance: 'Penicillin', severity: 'severe', recordedBy: reception.user.id }],
      portal: { hasAccount: false },
      isActive: true,
    });
    expect(res.body.data.age).toBeGreaterThanOrEqual(35);
    const stored = await Patient.findById(res.body.data.id).lean();
    expect(stored).toMatchObject({ nameKey: 'priya sharma', registeredBy: reception.user._id });

    const [entry] = await auditEntries('patient.create');
    expect(entry?.patient?.toString()).toBe(res.body.data.id);
    expect(entry?.resource).toMatchObject({ type: 'patient', number: 'MRN-000001' });
    // No patient details in the audit entry.
    expect(JSON.stringify(entry)).not.toMatch(/Priya|Sharma|9876543210|Penicillin/);
  });

  it('admins can register patients but not record allergies (403)', async () => {
    expect((await create(admin, valid)).status).toBe(201);
    const res = await create(admin, {
      ...valid,
      phone: '9876500001',
      firstName: 'Other',
      allergies: [{ substance: 'Dust', severity: 'mild' }],
    });
    expect(res.status).toBe(403);
    expectErrorShape(res.body, 'FORBIDDEN');
    expect(res.body.error.details).toEqual([
      { field: 'body.allergies', message: 'Your role cannot record allergies' },
    ]);
  });

  it('requires consent to data processing and valid fields', async () => {
    const res = await create(reception, {
      ...valid,
      consent: { dataProcessing: false },
      phone: '12',
      gender: 'x',
      dateOfBirth: '2999-01-01',
      chronicConditions: [],
    });
    const body = expectErrorShape(res.body, 'VALIDATION_ERROR');
    const fields = (body.error.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual([
      'body',
      'body.consent.dataProcessing',
      'body.dateOfBirth',
      'body.gender',
      'body.phone',
    ]);
  });

  describe('duplicate check (spec §4.3)', () => {
    it('same phone + DOB → 409 DUPLICATE_PATIENT with the match', async () => {
      const existing = await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
      const res = await create(reception, { ...valid, firstName: 'Different', lastName: 'Name' });
      expect(res.status).toBe(409);
      expectErrorShape(res.body, 'DUPLICATE_PATIENT');
      expect(res.body.error.details.matches).toEqual([
        {
          id: existing.id,
          mrn: existing.patient.mrn,
          fullName: `Test ${existing.patient.lastName}`,
          dateOfBirth: '1990-05-17',
          phone: '+919876543210',
          isActive: true,
          matchedOn: ['phone_dob'],
        },
      ]);
      expect(await Patient.countDocuments()).toBe(1);
    });

    it('same name + DOB (case and spaces ignored) → 409', async () => {
      await createPatient({ firstName: 'Priya', lastName: 'Sharma', dateOfBirth: '1990-05-17' });
      const res = await create(reception, { ...valid, firstName: ' PRIYA ', lastName: 'sharma' });
      expect(res.status).toBe(409);
      expect(res.body.error.details.matches[0].matchedOn).toEqual(['name_dob']);
    });

    it('reports both reasons when both match', async () => {
      await createPatient({
        firstName: 'Priya',
        lastName: 'Sharma',
        phone: '+919876543210',
        dateOfBirth: '1990-05-17',
      });
      const res = await create(reception, valid);
      expect(res.body.error.details.matches[0].matchedOn).toEqual(['phone_dob', 'name_dob']);
    });

    it('no false match: same phone or name with a different DOB', async () => {
      await createPatient({
        firstName: 'Priya',
        lastName: 'Sharma',
        phone: '+919876543210',
        dateOfBirth: '1990-05-18',
      });
      expect((await create(reception, valid)).status).toBe(201);
    });

    it('override needs force and a reason of at least 10 characters', async () => {
      await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
      const noReason = await create(reception, { ...valid, force: true });
      expect(expectErrorShape(noReason.body, 'VALIDATION_ERROR').error.details).toEqual([
        { field: 'body.reason', message: 'Give a reason of at least 10 characters' },
      ]);
      const short = await create(reception, { ...valid, force: true, reason: 'twins' });
      expect(short.status).toBe(400);
      // A reason without force is not an override.
      expect(
        (await create(reception, { ...valid, reason: 'Twin sister, same phone' })).status,
      ).toBe(409);
    });

    it('override with a reason creates the patient and audits the override', async () => {
      const existing = await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
      const res = await create(reception, {
        ...valid,
        force: true,
        reason: 'Twin sister, shares the family phone',
      });
      expect(res.status).toBe(201);
      const [entry] = await auditEntries('patient.create_duplicate_override');
      expect(entry).toMatchObject({
        patient: expect.anything(),
        metadata: {
          reason: 'Twin sister, shares the family phone',
          matches: [{ id: existing.id, mrn: existing.patient.mrn, matchedOn: ['phone_dob'] }],
        },
      });
      expect(entry?.patient?.toString()).toBe(res.body.data.id);
    });

    it('GET /patients/check-duplicate finds matches by phone (any format) or name', async () => {
      const a = await createPatient({ phone: '+919876543210', dateOfBirth: '1990-05-17' });
      const b = await createPatient({
        firstName: 'Priya',
        lastName: 'Sharma',
        dateOfBirth: '1990-05-17',
      });
      const res = await api()
        .get('/api/v1/patients/check-duplicate')
        .query({
          phone: '98765-43210',
          firstName: 'priya',
          lastName: 'SHARMA',
          dateOfBirth: '1990-05-17',
        })
        .set(reception.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.matches.map((m: { id: string }) => m.id)).toEqual([a.id, b.id]);

      const none = await api()
        .get('/api/v1/patients/check-duplicate')
        .query({ phone: '9876543210', dateOfBirth: '1990-05-18' })
        .set(reception.auth);
      expect(none.body.data.matches).toEqual([]);

      const missing = await api()
        .get('/api/v1/patients/check-duplicate')
        .query({ dateOfBirth: '1990-05-17', firstName: 'Priya' })
        .set(reception.auth);
      expectErrorShape(missing.body, 'VALIDATION_ERROR');
    });
  });

  it('50 parallel registrations get 50 unique, consecutive MRNs', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        create(reception, {
          ...valid,
          firstName: `Parallel${i}`,
          phone: `+9199${String(i).padStart(8, '0')}`,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(50).fill(201));
    const mrns = results.map((r) => r.body.data.mrn as string).sort();
    expect(new Set(mrns).size).toBe(50);
    expect(mrns).toEqual(
      Array.from({ length: 50 }, (_, i) => `MRN-${String(i + 1).padStart(6, '0')}`),
    );
  }, 60_000);
});
