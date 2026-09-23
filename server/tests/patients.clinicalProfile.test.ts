import type * as PatientAccess from '../src/policies/patientAccess.js';
import type { AuthUser } from '../src/types/express.js';
import { auditEntries, loginAs, resetDb } from './helpers/auth.js';
import { createPatient } from './helpers/fixtures.js';
import { api } from './helpers/testApp.js';

/**
 * PATCH /patients/:id/clinical-profile for a doctor WITH a care relationship. Care relationships
 * arrive in Phase 5, so this file stands one in: the policy grants doctors access to
 * `relatedPatientId` only.
 */
let relatedPatientId = '';
vi.mock('../src/policies/patientAccess.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PatientAccess>();
  const related = (user: Pick<AuthUser, 'role'>, id: unknown) =>
    user.role === 'doctor' && String(id) === relatedPatientId;
  return {
    ...actual,
    canAccessPatient: (user: AuthUser, id: string, scope: never) =>
      related(user, id) || actual.canAccessPatient(user, id, scope),
    assertCanAccessPatient: async (user: AuthUser, id: string, scope: never, meta: never) =>
      related(user, id) ? undefined : actual.assertCanAccessPatient(user, id, scope, meta),
  };
});

describe('clinical profile with a (stand-in) care relationship', () => {
  beforeEach(resetDb);

  it('records allergies and chronic conditions with recordedBy/At, audited without values', async () => {
    const { id } = await createPatient({
      allergies: [{ substance: 'Dust', severity: 'mild', recordedAt: new Date(0) }],
    });
    relatedPatientId = id;
    const doctor = await loginAs('doctor');
    const current = await api().get(`/api/v1/patients/${id}`).set(doctor.auth);
    expect(current.status).toBe(200);
    expect(current.body.data).not.toHaveProperty('adminNotes');
    expect(current.body.data).not.toHaveProperty('insurance');
    const dust = current.body.data.allergies[0];

    const res = await api()
      .patch(`/api/v1/patients/${id}/clinical-profile`)
      .set(doctor.auth)
      .send({
        allergies: [{ id: dust.id, substance: 'Dust', severity: 'mild' }],
        chronicConditions: [
          { name: 'Type 2 diabetes', since: '2019-03-01', notes: 'On metformin' },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.allergies).toEqual([dust]);
    expect(res.body.data.chronicConditions).toEqual([
      expect.objectContaining({
        name: 'Type 2 diabetes',
        since: '2019-03-01',
        recordedBy: doctor.user.id,
        recordedAt: expect.any(String),
      }),
    ]);

    const [entry] = await auditEntries('patient.clinical_profile_update');
    expect(entry?.changes?.fields).toEqual(['chronicConditions']);
    expect(JSON.stringify(entry)).not.toMatch(/diabetes|metformin/i);
  });

  it('a doctor without the relationship still gets 404', async () => {
    const { id } = await createPatient();
    relatedPatientId = 'someone-else';
    const res = await api()
      .patch(`/api/v1/patients/${id}/clinical-profile`)
      .set((await loginAs('doctor')).auth)
      .send({ chronicConditions: [] });
    expect(res.status).toBe(404);
  });
});
