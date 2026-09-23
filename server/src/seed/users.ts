import { AUDIT_ACTIONS, ROLES, type Role } from '../config/constants.js';
import { User } from '../modules/users/model.js';
import * as audit from '../services/audit.service.js';
import { hashPassword } from '../utils/password.js';

/** Shared password of every demo account (spec §15.3). Demo data only. */
export const DEMO_PASSWORD = 'Password@123';

export interface DemoAccount {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

/**
 * Staff and patient demo logins (spec §15.3: 1 admin, 2 receptionists, 2 lab techs). Doctors are
 * seeded with their profiles by seed/doctors.ts.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'admin@medassist.dev', firstName: 'Asha', lastName: 'Rao', role: ROLES.ADMIN },
  {
    email: 'reception1@medassist.dev',
    firstName: 'Ravi',
    lastName: 'Kumar',
    role: ROLES.RECEPTIONIST,
  },
  {
    email: 'reception2@medassist.dev',
    firstName: 'Meena',
    lastName: 'Pillai',
    role: ROLES.RECEPTIONIST,
  },
  { email: 'lab1@medassist.dev', firstName: 'Lakshmi', lastName: 'Nair', role: ROLES.LABTECH },
  { email: 'lab2@medassist.dev', firstName: 'Arjun', lastName: 'Reddy', role: ROLES.LABTECH },
  // Patient records and linking arrive in Phase 3; these are portal logins only for now.
  { email: 'patient1@medassist.dev', firstName: 'Priya', lastName: 'Sharma', role: ROLES.PATIENT },
  { email: 'patient2@medassist.dev', firstName: 'Rahul', lastName: 'Verma', role: ROLES.PATIENT },
];

/** Hash of the demo password (computed once per seed run). */
export const demoPasswordHash = () => hashPassword(DEMO_PASSWORD);

/**
 * Update that puts an account in a usable demo state: demo password, active, unlocked, no forced
 * password change, no pending reset link.
 */
export const demoAccountState = (passwordHash: string) => ({
  $set: {
    passwordHash,
    mustChangePassword: false,
    isActive: true,
    failedLoginAttempts: 0,
  },
  $unset: { lockUntil: 1, lastFailedLoginAt: 1, passwordReset: 1 },
});

/**
 * Upserts the demo accounts: creates missing ones and resets existing ones to a usable state.
 * @returns how many accounts were created and updated.
 */
export async function seedUsers(): Promise<{ created: number; updated: number }> {
  const passwordHash = await demoPasswordHash();
  const state = demoAccountState(passwordHash);
  let created = 0;
  let updated = 0;

  for (const account of DEMO_ACCOUNTS) {
    const result = await User.findOneAndUpdate(
      { email: account.email },
      {
        $set: {
          ...state.$set,
          firstName: account.firstName,
          lastName: account.lastName,
          role: account.role,
        },
        $unset: state.$unset,
        $setOnInsert: { emailVerifiedAt: new Date() },
      },
      { upsert: true, new: true, includeResultMetadata: true, runValidators: true },
    );
    const user = result.value;
    if (!user) continue;
    const inserted = !result.lastErrorObject?.updatedExisting;
    if (inserted) created += 1;
    else updated += 1;

    await audit.record({
      action: inserted ? AUDIT_ACTIONS.USER_CREATE : AUDIT_ACTIONS.USER_UPDATE,
      actor: null, // system
      resource: { type: 'user', id: user._id },
      metadata: { role: user.role, source: 'seed' },
    });
  }
  return { created, updated };
}
