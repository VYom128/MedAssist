import { Types } from 'mongoose';
import type { PatientAccessScope, Role } from '../src/config/constants.js';
import { Appointment } from '../src/modules/appointments/model.js';
import {
  assertCanAccessPatient,
  canAccessPatient,
  CARE_RELATIONSHIP_CHECKS,
  hasAppointmentRelationship,
  patientListFilter,
  roleHasPatientScope,
  SCOPES,
} from '../src/policies/patientAccess.js';
import type { AuthUser } from '../src/types/express.js';
import { auditEntries, resetDb } from './helpers/auth.js';
import { insertAppointment } from './helpers/fixtures.js';

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
const EXPECTED: Record<Exclude<Role, 'patient' | 'doctor'>, PatientAccessScope[]> = {
  admin: ['demographics', 'billing'],
  receptionist: ['demographics', 'billing', 'allergies'], // allergies: front-desk safety info
  labtech: [], // through lab orders from Phase 6
};

/** What a doctor with a care relationship gets (spec §2.3, §2.5): no billing. */
const DOCTOR_WITH_RELATIONSHIP: PatientAccessScope[] = [
  'demographics',
  'clinical',
  'lab',
  'allergies',
];

/** An appointment of `doctor` with `patient` (any status; startAt in the past by default). */
const appointmentWith = (doctor: AuthUser, patient: string, status = 'completed') =>
  insertAppointment({
    patient,
    doctor: doctor.id,
    startAt: new Date(Date.now() - 86_400_000 + Math.floor(Math.random() * 1e6)),
    status,
    isSlotActive: false,
  });

describe('canAccessPatient – role scopes', () => {
  it('exports the five scopes', () => {
    expect(SCOPES).toEqual(['demographics', 'clinical', 'billing', 'lab', 'allergies']);
  });

  for (const [role, allowed] of Object.entries(EXPECTED)) {
    for (const scope of SCOPES) {
      const expected = allowed.includes(scope);
      it(`${role} → ${scope}: ${expected ? 'allowed' : 'denied'}`, async () => {
        expect(await canAccessPatient(userOf(role as Role), patientId, scope)).toBe(expected);
        expect(roleHasPatientScope(userOf(role as Role), scope)).toBe(expected);
      });
    }
  }

  it('admins and receptionists never get clinical access', async () => {
    expect(await canAccessPatient(userOf('admin'), patientId, 'clinical')).toBe(false);
    expect(await canAccessPatient(userOf('receptionist'), patientId, 'clinical')).toBe(false);
  });

  it('a patient or doctor has no role-wide scope', () => {
    for (const scope of SCOPES) {
      expect(roleHasPatientScope(userOf('patient'), scope)).toBe(false);
      expect(roleHasPatientScope(userOf('doctor'), scope)).toBe(false);
    }
  });

  it('a patient can access only their own record, in every scope', async () => {
    for (const scope of SCOPES) {
      expect(await canAccessPatient(userOf('patient', patientId), patientId, scope)).toBe(true);
      expect(
        await canAccessPatient(userOf('patient', patientId), new Types.ObjectId(), scope),
      ).toBe(false);
      expect(await canAccessPatient(userOf('patient', null), patientId, scope)).toBe(false);
    }
  });
});

describe('canAccessPatient – doctor care relationship (spec §2.3)', () => {
  beforeEach(resetDb);

  it('the checks are pluggable, starting with the appointment relationship', () => {
    expect(CARE_RELATIONSHIP_CHECKS).toEqual([hasAppointmentRelationship]);
  });

  it('without any appointment: nothing', async () => {
    const doctor = userOf('doctor');
    for (const scope of SCOPES)
      expect(await canAccessPatient(doctor, patientId, scope)).toBe(false);
  });

  it('with a non-cancelled appointment (past, future or no-show): demographics, clinical, lab and allergies – never billing', async () => {
    for (const status of ['completed', 'scheduled', 'no_show', 'checked_in', 'in_consultation']) {
      const doctor = userOf('doctor');
      const patient = new Types.ObjectId().toString();
      await appointmentWith(doctor, patient, status);
      for (const scope of SCOPES) {
        expect(await canAccessPatient(doctor, patient, scope), `${status} ${scope}`).toBe(
          DOCTOR_WITH_RELATIONSHIP.includes(scope),
        );
      }
    }
  });

  it('only cancelled appointments → no relationship', async () => {
    const doctor = userOf('doctor');
    await appointmentWith(doctor, patientId, 'cancelled');
    await appointmentWith(doctor, patientId, 'cancelled');
    expect(await canAccessPatient(doctor, patientId, 'clinical')).toBe(false);
  });

  it("another doctor's appointment gives this doctor nothing", async () => {
    const mine = userOf('doctor');
    const other = userOf('doctor');
    await appointmentWith(other, patientId);
    expect(await canAccessPatient(other, patientId, 'clinical')).toBe(true);
    expect(await canAccessPatient(mine, patientId, 'clinical')).toBe(false);
  });

  it('caches the answer per request (per AuthUser object): one query per patient', async () => {
    const doctor = userOf('doctor');
    await appointmentWith(doctor, patientId);
    const spy = vi.spyOn(Appointment, 'exists');
    try {
      for (const scope of ['clinical', 'demographics', 'lab', 'allergies'] as const) {
        expect(await canAccessPatient(doctor, patientId, scope)).toBe(true);
      }
      await assertCanAccessPatient(doctor, patientId, 'clinical');
      expect(spy).toHaveBeenCalledTimes(1);

      // Parallel calls share the pending lookup.
      const other = new Types.ObjectId().toString();
      await Promise.all([1, 2, 3].map(() => canAccessPatient(doctor, other, 'clinical')));
      expect(spy).toHaveBeenCalledTimes(2);

      // The next request (a new AuthUser object for the same doctor) asks the database again,
      // so a relationship that ended is not remembered.
      await Appointment.updateMany({}, { $set: { status: 'cancelled', isSlotActive: false } });
      expect(await canAccessPatient({ ...doctor }, patientId, 'clinical')).toBe(false);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('a malformed patient id is simply denied (no query)', async () => {
    expect(await canAccessPatient(userOf('doctor'), 'not-an-id', 'clinical')).toBe(false);
  });
});

describe('patientListFilter', () => {
  beforeEach(resetDb);

  it('admins and receptionists list every patient; lab techs and patients none', async () => {
    expect(await patientListFilter(userOf('admin'))).toEqual({});
    expect(await patientListFilter(userOf('receptionist'))).toEqual({});
    for (const role of ['labtech', 'patient'] as const) {
      expect(await patientListFilter(userOf(role))).toEqual({ _id: { $in: [] } });
    }
  });

  it('a doctor lists the patients of their non-cancelled appointments', async () => {
    const doctor = userOf('doctor');
    const seen = new Types.ObjectId().toString();
    const cancelled = new Types.ObjectId().toString();
    await appointmentWith(doctor, seen);
    await appointmentWith(doctor, seen, 'scheduled');
    await appointmentWith(doctor, cancelled, 'cancelled');
    await appointmentWith(userOf('doctor'), new Types.ObjectId().toString());
    const filter = (await patientListFilter(doctor)) as { _id: { $in: Types.ObjectId[] } };
    expect(filter._id.$in.map(String)).toEqual([seen]);
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
