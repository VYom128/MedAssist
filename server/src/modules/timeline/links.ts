import { ROLES, type Role } from '../../config/constants.js';

/**
 * Client pages the timeline items open, per role (spec §13.1). Null when the role has no page
 * for the item.
 */
const PORTAL = '/patient';
const staffBase = (role: Role) =>
  role === ROLES.DOCTOR ? '/doctor' : role === ROLES.RECEPTIONIST ? '/reception' : null;

export const links = {
  appointment(role: Role, id: string) {
    if (role === ROLES.PATIENT) return `${PORTAL}/appointments`;
    const base = staffBase(role);
    return base ? `${base}/appointments/${id}` : null;
  },
  encounter(role: Role, id: string) {
    if (role === ROLES.PATIENT) return `${PORTAL}/visits/${id}`;
    return role === ROLES.DOCTOR ? `/doctor/encounters/${id}` : null;
  },
  prescription(role: Role, id: string, encounterId: string) {
    if (role === ROLES.PATIENT) return `${PORTAL}/prescriptions/${id}`;
    return role === ROLES.DOCTOR ? `/doctor/encounters/${encounterId}` : null;
  },
  labOrder(role: Role, id: string) {
    if (role === ROLES.PATIENT) return `${PORTAL}/lab-reports/${id}`;
    return role === ROLES.DOCTOR ? `/doctor/lab-orders/${id}` : null;
  },
  invoice(role: Role, id: string) {
    if (role === ROLES.PATIENT) return `${PORTAL}/invoices/${id}`;
    return role === ROLES.RECEPTIONIST ? `/reception/invoices/${id}` : null;
  },
  documents(role: Role, patientId: string) {
    if (role === ROLES.PATIENT) return `${PORTAL}/documents`;
    if (role === ROLES.RECEPTIONIST) return `/reception/patients/${patientId}?tab=documents`;
    return role === ROLES.DOCTOR ? `/doctor/patients/${patientId}` : null;
  },
};
