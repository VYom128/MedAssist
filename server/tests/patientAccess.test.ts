import { Types } from 'mongoose';
import {
  PATIENT_ACCESS_SCOPES,
  type PatientAccessScope,
  type Role,
} from '../src/config/constants.js';
import { assertCanAccessPatient, canAccessPatient } from '../src/policies/patientAccess.js';
import type { AuthUser } from '../src/types/express.js';
import { auditEntries, resetDb } from './helpers/auth.js';

const patientId = new Types.ObjectId().toString();

const userOf = (role: Role, patient: string | null = null): AuthUser => ({
  id: new Types.ObjectId().toString(),
  role,
  sid: new Types.ObjectId().toString(),
  sessionFamily: 'test-family',
  firstName: 'Test',
  lastName: role,
  patientId: patient,
});

/** Expected access per role for any patient in Phase 1 (spec §2.4). */
const EXPECTED: Record<Exclude<Role, 'patient'>, PatientAccessScope[]> = {
  admin: ['demographics', 'billing'],
  receptionist: ['demographics', 'billing'],
  labtech: ['demographics', 'lab'],
  doctor: [], // no care relationships exist until appointments (Phase 4)
};

describe('canAccessPatient', () => {
  for (const [role, allowed] of Object.entries(EXPECTED)) {
    for (const scope of PATIENT_ACCESS_SCOPES) {
      const expected = allowed.includes(scope);
      it(`${role} → ${scope}: ${expected ? 'allowed' : 'denied'}`, async () => {
        expect(await canAccessPatient(userOf(role as Role), patientId, scope)).toBe(expected);
      });
    }
  }

  it('admins and receptionists never get clinical access', async () => {
    expect(await canAccessPatient(userOf('admin'), patientId, 'clinical')).toBe(false);
    expect(await canAccessPatient(userOf('receptionist'), patientId, 'clinical')).toBe(false);
  });

  it('a patient can access only their own record, in every scope', async () => {
    for (const scope of PATIENT_ACCESS_SCOPES) {
      expect(await canAccessPatient(userOf('patient', patientId), patientId, scope)).toBe(true);
      expect(
        await canAccessPatient(userOf('patient', patientId), new Types.ObjectId(), scope),
      ).toBe(false);
      expect(await canAccessPatient(userOf('patient', null), patientId, scope)).toBe(false);
    }
  });
});

describe('assertCanAccessPatient', () => {
  beforeEach(resetDb);

  it('throws 404 (not 403) and audits the denial with the patient set', async () => {
    const doctor = userOf('doctor');
    await expect(assertCanAccessPatient(doctor, patientId, 'clinical')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    const [entry] = await auditEntries('access.denied');
    expect(entry).toMatchObject({
      outcome: 'denied',
      metadata: { reason: 'patient_access', scope: 'clinical' },
    });
    expect(entry?.patient?.toString()).toBe(patientId);
    expect(entry?.actor?.user?.toString()).toBe(doctor.id);
  });

  it('resolves silently when access is allowed', async () => {
    await expect(
      assertCanAccessPatient(userOf('admin'), patientId, 'billing'),
    ).resolves.toBeUndefined();
    expect(await auditEntries('access.denied')).toHaveLength(0);
  });
});
