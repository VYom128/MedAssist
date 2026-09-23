import { Types } from 'mongoose';
import type { PatientAccessScope, Role } from '../src/config/constants.js';
import {
  assertCanAccessPatient,
  canAccessPatient,
  patientListFilter,
  roleHasPatientScope,
  SCOPES,
} from '../src/policies/patientAccess.js';
import type { AuthUser } from '../src/types/express.js';
import { auditEntries, resetDb } from './helpers/auth.js';

const patientId = new Types.ObjectId().toString();

const userOf = (role: Role, patient: string | null = null): AuthUser => ({
  id: new Types.ObjectId().toString(),
  role,
  sessionId: new Types.ObjectId().toString(),
  sessionFamily: 'test-family',
  firstName: 'Test',
  lastName: role,
  email: `${role}@test.dev`,
  mustChangePassword: false,
  patientId: patient,
});

/** Expected access per staff role for any patient (spec §2.4, Phase 3 decisions). */
const EXPECTED: Record<Exclude<Role, 'patient'>, PatientAccessScope[]> = {
  admin: ['demographics', 'billing'],
  receptionist: ['demographics', 'billing', 'allergies'], // allergies: front-desk safety info
  labtech: [], // through lab orders from Phase 6
  doctor: [], // care relationship arrives in Phase 5
};

describe('canAccessPatient', () => {
  it('exports the five scopes', () => {
    expect(SCOPES).toEqual(['demographics', 'clinical', 'billing', 'lab', 'allergies']);
  });

  it('is synchronous and pure (no database needed)', () => {
    expect(canAccessPatient(userOf('admin'), patientId, 'demographics')).toBe(true);
  });

  for (const [role, allowed] of Object.entries(EXPECTED)) {
    for (const scope of SCOPES) {
      const expected = allowed.includes(scope);
      it(`${role} → ${scope}: ${expected ? 'allowed' : 'denied'}`, () => {
        expect(canAccessPatient(userOf(role as Role), patientId, scope)).toBe(expected);
        expect(roleHasPatientScope(userOf(role as Role), scope)).toBe(expected);
      });
    }
  }

  it('admins and receptionists never get clinical access', () => {
    expect(canAccessPatient(userOf('admin'), patientId, 'clinical')).toBe(false);
    expect(canAccessPatient(userOf('receptionist'), patientId, 'clinical')).toBe(false);
  });

  it('admins and receptionists list every patient; doctors and others none (until Phase 5)', () => {
    expect(patientListFilter(userOf('admin'))).toEqual({});
    expect(patientListFilter(userOf('receptionist'))).toEqual({});
    for (const role of ['doctor', 'labtech', 'patient'] as const) {
      expect(patientListFilter(userOf(role))).toEqual({ _id: { $in: [] } });
    }
  });

  it('a patient has no role-wide scope (only their own record)', () => {
    for (const scope of SCOPES) expect(roleHasPatientScope(userOf('patient'), scope)).toBe(false);
  });

  it('a patient can access only their own record, in every scope', () => {
    for (const scope of SCOPES) {
      expect(canAccessPatient(userOf('patient', patientId), patientId, scope)).toBe(true);
      expect(canAccessPatient(userOf('patient', patientId), new Types.ObjectId(), scope)).toBe(
        false,
      );
      expect(canAccessPatient(userOf('patient', null), patientId, scope)).toBe(false);
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
