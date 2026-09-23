import { ROLES, type Role } from '../config/constants.js';
import { User } from '../modules/users/model.js';
import type { AuthUser } from '../types/express.js';
import type { RequestMeta } from '../utils/requestContext.js';

/** Audit `request` for changes made by the seed (the path says where they came from). */
export const SEED_REQUEST: RequestMeta = { id: 'seed', method: 'SEED', path: 'npm run seed' };

/** What a seeder did, per record. */
export interface SeedCounts {
  created: number;
  updated: number;
  unchanged: number;
  [extra: string]: number;
}

export const counts = (): SeedCounts => ({ created: 0, updated: 0, unchanged: 0 });

/**
 * A demo staff user (the admin by default) as the actor for the services the seed calls, so
 * their validation and audit run as for a real user; audit entries carry SEED_REQUEST. The users
 * seeder runs first.
 */
export async function seedActor(
  email = 'admin@medassist.dev',
  role: Role = ROLES.ADMIN,
): Promise<AuthUser> {
  const admin = await User.findOne({ email, role }).lean();
  if (!admin) throw new Error(`Seed ${role} ${email} is missing; run the users seeder first`);
  return {
    id: admin._id.toString(),
    role,
    sessionId: 'seed',
    sessionFamily: 'seed',
    firstName: admin.firstName,
    lastName: admin.lastName,
    email: admin.email,
    mustChangePassword: false,
    patientId: null,
  };
}

/** Whether an update service call changed the record (it leaves `updatedAt` alone on no-ops). */
export const changed = (before: { updatedAt?: Date | null }, after: { updatedAt?: Date | null }) =>
  new Date(before.updatedAt ?? 0).getTime() !== new Date(after.updatedAt ?? 0).getTime();
