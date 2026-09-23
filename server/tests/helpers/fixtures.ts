import { Department } from '../../src/modules/departments/model.js';
import { DoctorProfile } from '../../src/modules/doctors/model.js';
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
