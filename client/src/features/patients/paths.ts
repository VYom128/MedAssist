import { ROLES, type Role } from '../../constants/roles';

/** Where a role's patient pages live: /admin/patients or /reception/patients. */
export const patientsBase = (role: Role | undefined) =>
  role === ROLES.ADMIN ? '/admin/patients' : '/reception/patients';

/** "34 y · F" */
export const ageSex = (age: number, genderShort: string) => `${age} y · ${genderShort}`;
