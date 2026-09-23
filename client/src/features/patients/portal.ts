import type { PortalInfo } from './api';

export type PortalState = 'none' | 'invited' | 'linked' | 'pending';

/**
 * none · invited (account not used yet) · linked · pending (self-signup waiting for the ID check).
 * List rows only know `hasPortal`, so they show linked or none.
 */
export function portalState(portal: PortalInfo | undefined, hasPortal: boolean): PortalState {
  if (!portal) return hasPortal ? 'linked' : 'none';
  if (!portal.hasAccount) return 'none';
  if (portal.linkStatus === 'pending_verification') return 'pending';
  return portal.lastLoginAt ? 'linked' : 'invited';
}
