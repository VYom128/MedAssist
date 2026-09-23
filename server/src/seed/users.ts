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

/** One login per role, plus the second doctor and patient listed in spec §15.3. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'admin@medassist.dev', firstName: 'Asha', lastName: 'Rao', role: ROLES.ADMIN },
  {
    email: 'reception1@medassist.dev',
    firstName: 'Ravi',
    lastName: 'Kumar',
    role: ROLES.RECEPTIONIST,
  },
  { email: 'lab1@medassist.dev', firstName: 'Lakshmi', lastName: 'Nair', role: ROLES.LABTECH },
  { email: 'dr.mehta@medassist.dev', firstName: 'Anil', lastName: 'Mehta', role: ROLES.DOCTOR },
  { email: 'dr.iyer@medassist.dev', firstName: 'Kavya', lastName: 'Iyer', role: ROLES.DOCTOR },
  // Patient records and linking arrive in Phase 3; these are portal logins only for now.
  { email: 'patient1@medassist.dev', firstName: 'Priya', lastName: 'Sharma', role: ROLES.PATIENT },
  { email: 'patient2@medassist.dev', firstName: 'Rahul', lastName: 'Verma', role: ROLES.PATIENT },
];

/**
 * Upserts the demo accounts: creates missing ones and resets existing ones to a usable state
 * (demo password, active, unlocked, no forced password change).
 * @returns how many accounts were created and updated.
 */
export async function seedUsers(): Promise<{ created: number; updated: number }> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  let created = 0;
  let updated = 0;

  for (const account of DEMO_ACCOUNTS) {
    const result = await User.findOneAndUpdate(
      { email: account.email },
      {
        $set: {
          firstName: account.firstName,
          lastName: account.lastName,
          role: account.role,
          passwordHash,
          mustChangePassword: false,
          isActive: true,
          failedLoginAttempts: 0,
        },
        $unset: { lockUntil: 1, lastFailedLoginAt: 1, passwordReset: 1 },
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
