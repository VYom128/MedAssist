import { KeyRound, MonitorSmartphone, UserRound } from 'lucide-react';

/** Account pages every signed-in user has (user menu entries and top-bar titles). */
export const ACCOUNT_LINKS = [
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/sessions', label: 'Sessions', icon: MonitorSmartphone },
  { to: '/change-password', label: 'Change password', icon: KeyRound },
] as const;
