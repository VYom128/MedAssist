/** Mirrors ROLES in server/src/config/constants.ts. */
export const ROLES = {
  ADMIN: 'admin',
  DOCTOR: 'doctor',
  RECEPTIONIST: 'receptionist',
  LABTECH: 'labtech',
  PATIENT: 'patient',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_VALUES = Object.values(ROLES) as Role[];

/** Staff roles an admin can create (server STAFF_ROLES). */
export const STAFF_ROLES = [ROLES.ADMIN, ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.LABTECH] as const;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  labtech: 'Lab technician',
  patient: 'Patient',
};

/** URL prefix of each role's area (spec §13.1). */
export const ROLE_BASE: Record<Role, string> = {
  admin: '/admin',
  doctor: '/doctor',
  receptionist: '/reception',
  labtech: '/lab',
  patient: '/patient',
};

/** Where each role lands after login. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin/dashboard',
  doctor: '/doctor/dashboard',
  receptionist: '/reception/dashboard',
  labtech: '/lab/dashboard',
  patient: '/patient/dashboard',
};
