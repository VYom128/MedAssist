import { migrateLinkPatients } from '../src/migrations/linkPatients.js';
import { Patient } from '../src/modules/patients/model.js';
import { User } from '../src/modules/users/model.js';
import { auditEntries, createUser, resetDb } from './helpers/auth.js';
import { createPatient, loginAsPatient } from './helpers/fixtures.js';

describe('migrate:link-patients', () => {
  beforeEach(resetDb);

  it('links pre-Phase 3 patient users with enough data, lists the rest, and is idempotent', async () => {
    const complete = await createUser('patient', {
      firstName: 'Old',
      lastName: 'Signup',
      phone: '098765 43210',
      dateOfBirth: new Date('1990-05-17T00:00:00Z'),
      termsAcceptedAt: new Date(),
    });
    const noDob = await createUser('patient', { firstName: 'No', lastName: 'Dob' });
    const noPhone = await createUser('patient', {
      phone: undefined,
      dateOfBirth: new Date('1980-01-01T00:00:00Z'),
    });
    const dangling = await createUser('patient', {
      patient: '0'.repeat(24),
      dateOfBirth: new Date('1970-01-01T00:00:00Z'),
    });
    // Left alone: already linked, pending verification, staff.
    const linked = await loginAsPatient();
    const target = await createPatient();
    await createUser('patient', {
      patient: target.id,
      patientLinkStatus: 'pending_verification',
      dateOfBirth: new Date('1985-06-15T00:00:00Z'),
    });
    await createUser('receptionist');

    const first = await migrateLinkPatients();
    expect(first.linked.map((l) => l.userId).sort()).toEqual(
      [complete._id.toString(), dangling._id.toString()].sort(),
    );
    expect(first.skipped).toEqual(
      expect.arrayContaining([
        { userId: noDob._id.toString(), email: noDob.email, missing: ['dateOfBirth'] },
        { userId: noPhone._id.toString(), email: noPhone.email, missing: ['phone'] },
      ]),
    );
    expect(first.skipped).toHaveLength(2);

    const user = await User.findById(complete._id).lean();
    const patient = await Patient.findById(user!.patient).lean();
    expect(user).toMatchObject({ patientLinkStatus: 'linked', phone: '+919876543210' });
    expect(patient).toMatchObject({
      firstName: 'Old',
      lastName: 'Signup',
      phone: '+919876543210',
      gender: 'unknown',
      user: complete._id,
    });
    expect(await auditEntries('patient.create')).toHaveLength(2);
    expect(await User.findById(linked.user._id).lean()).toMatchObject({
      patientLinkStatus: 'linked',
    });

    const patientsBefore = await Patient.countDocuments();
    const second = await migrateLinkPatients();
    expect(second.linked).toEqual([]);
    expect(second.skipped).toHaveLength(2);
    expect(await Patient.countDocuments()).toBe(patientsBefore);
  });
});
