import { ROLE_HOME, type Role } from '../constants/roles';

export interface NavItem {
  label: string;
  to: string;
}

/** Sidebar items per role. Feature pages are added here as each phase builds them (spec §13.1). */
export function navItemsFor(role: Role): NavItem[] {
  return [{ label: 'Dashboard', to: ROLE_HOME[role] }];
}

/** Account links shown for every role. */
export const ACCOUNT_NAV: NavItem[] = [
  { label: 'My profile', to: '/profile' },
  { label: 'Active sessions', to: '/sessions' },
  { label: 'Change password', to: '/change-password' },
];
