import type { Role } from '../../constants/roles';

/** One line per page for the dashboard quick links (from each page's own description). */
export const LINK_DESCRIPTIONS: Record<string, string> = {
  '/admin/users': 'Staff and patient login accounts.',
  '/admin/appointments': 'All appointments, read-only.',
  '/admin/patients': 'Find patients and open their records.',
  '/admin/departments': 'Clinic departments that doctors and services belong to.',
  '/admin/services': 'Consultations, procedures and other billable items.',
  '/admin/doctors': 'Doctor profiles, weekly schedules and leave.',
  '/admin/lab-tests': 'The tests doctors can order, with parameters and reference ranges.',
  '/admin/audit-logs': 'Every sign-in, account change and denied access.',
  '/admin/settings': 'Clinic, appointment, billing, lab, AI and notification settings.',
  '/reception/appointments': 'Book, move and follow appointments in a calendar or list.',
  '/reception/queue': "Today's queues, check-ins and walk-ins.",
  '/reception/patients': 'Register new patients, find existing ones and update their details.',
  '/reception/pending-links': 'Patients who signed up online and are waiting for an ID check.',
  '/doctor/queue': 'The patient with you now, who is next, and Call next.',
  '/doctor/appointments': 'Your own appointments in a calendar or list.',
  '/doctor/schedule': 'Your weekly hours and leave.',
  '/doctor/profile': 'What patients see when they book with you.',
  '/patient/appointments': 'Book, change or cancel your appointments.',
  '/patient/profile': 'Your patient record at the clinic.',
  '/profile': 'Your name and contact number.',
  '/sessions': 'Devices where you are signed in.',
};

/** Short line under the greeting. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Clinic set-up, staff accounts and records.',
  doctor: 'Your queue, appointments, schedule and the profile patients see.',
  receptionist: 'Appointments, the queue, patient registration and identity checks.',
  labtech: 'Your lab workspace.',
  patient: 'Your appointments and your record at the clinic.',
};
