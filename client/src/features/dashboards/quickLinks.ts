import type { Role } from '../../constants/roles';

/** Short line under the dashboard greeting. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Today at the clinic, revenue, utilisation and alerts.',
  doctor: 'Your queue, notes to sign and results to review.',
  receptionist: 'Today’s appointments, check-ins, unpaid invoices and follow-ups.',
  labtech: 'Open orders, turnaround and results waiting for verification.',
  patient: 'Your appointments and your record at the clinic.',
};
