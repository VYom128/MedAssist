import { ROLE_HOME } from '../constants/roles';
import type { CurrentUser } from '../features/auth/authSlice';

/** Where a self-registered patient waiting for the ID check is told what to bring (spec §4.4). */
export const VERIFY_IDENTITY_PATH = '/patient/verify-identity';

/**
 * Where a signed-in user starts: their role dashboard, or the ID-check screen for a patient whose
 * record link is still pending. Used by login, register and the public-only/home redirects, so
 * they never race each other to different pages.
 */
export function homeFor(user: Pick<CurrentUser, 'role' | 'patientLinkStatus'>): string {
  return user.role === 'patient' && user.patientLinkStatus === 'pending_verification'
    ? VERIFY_IDENTITY_PATH
    : ROLE_HOME[user.role];
}
