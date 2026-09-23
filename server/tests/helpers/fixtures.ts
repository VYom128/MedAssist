import { Department } from '../../src/modules/departments/model.js';
import { DoctorProfile } from '../../src/modules/doctors/model.js';
import { Patient } from '../../src/modules/patients/model.js';
import { insertPatient } from '../../src/modules/patients/service.js';
import { calendarDate } from '../../src/utils/dates.js';
import { createUser, loginAs, type LoggedIn } from './auth.js';
import { letters } from './rbacMatrix.js';

let n = 0;

/** An active department with a unique name and code. */
export async function createDepartment(overrides: Record<string, unknown> = {}) {
  n += 1;
  return Department.create({ name: `Department ${n}`, code: `DP${letters(n)}`, ...overrides });
}

/** Adds a doctor profile to an existing doctor User. */
export async function addDoctorProfile(userId: unknown, overrides: Record<string, unknown> = {}) {
  n += 1;
  const department = overrides.department ?? (await createDepartment())._id;
  return DoctorProfile.create({
    user: userId,
    department,
    specialization: 'General Physician',
    registrationNumber: `KMC-${n}`,
    ...overrides,
  });
}

/** A doctor User (active unless overridden) with a profile. */
export async function createDoctor(
  userOverrides: Record<string, unknown> = {},
  profileOverrides: Record<string, unknown> = {},
) {
  const user = await createUser('doctor', userOverrides);
  const profile = await addDoctorProfile(user._id, profileOverrides);
  return { user, profile, id: user._id.toString() };
}

/** Logs in as a doctor who has a profile. */
export async function loginAsDoctor(
  profileOverrides: Record<string, unknown> = {},
): Promise<LoggedIn & { id: string }> {
  const me = await loginAs('doctor');
  await addDoctorProfile(me.user._id, profileOverrides);
  return { ...me, id: me.user._id.toString() };
}

let p = 0;

/** A unique valid Indian mobile number in E.164 ('+919000000001', …). */
export const uniquePhone = () => {
  p += 1;
  return `+9190${String(p).padStart(8, '0')}`;
};

/**
 * A patient (through the service's insert, so it gets a real MRN). Overrides use stored forms:
 * E.164 phone, `dateOfBirth` as 'YYYY-MM-DD'.
 */
export async function createPatient(
  overrides: Record<string, unknown> & { dateOfBirth?: string } = {},
) {
  p += 1;
  const { dateOfBirth = '1985-06-15', ...rest } = overrides;
  const created = await insertPatient({
    firstName: 'Test',
    lastName: `Patient${p}`,
    dateOfBirth: calendarDate(dateOfBirth),
    gender: 'female',
    phone: uniquePhone(),
    consent: { dataProcessing: { given: true, at: new Date() } },
    ...rest,
  } as never);
  return { patient: created, id: created._id.toString() };
}

/** Logs in as a patient user linked to a new Patient record (or to `patientOverrides`' one). */
export async function loginAsPatient(
  patientOverrides: Record<string, unknown> & { dateOfBirth?: string } = {},
): Promise<LoggedIn & { patientId: string }> {
  const { id } = await createPatient(patientOverrides);
  const me = await loginAs('patient', { patient: id, patientLinkStatus: 'linked' });
  await Patient.updateOne({ _id: id }, { $set: { user: me.user._id } });
  return { ...me, patientId: id };
}
