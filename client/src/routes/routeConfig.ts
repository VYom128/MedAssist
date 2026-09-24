import {
  Building2,
  CalendarClock,
  CalendarDays,
  FileText,
  FlaskConical,
  IdCard,
  ListOrdered,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ROLES, type Role } from '../constants/roles';

export interface AppRoute {
  path: string;
  /** Roles allowed to open the page (RoleRoute). */
  roles: readonly Role[];
  /** Lazy page component, so each area is its own bundle (spec §13.1). */
  load: () => Promise<{ default: ComponentType }>;
  /** Sidebar entry; pages without it (e.g. details) are not in the menu. */
  nav?: { label: string; icon: LucideIcon; badge?: NavBadgeKind };
}

/** Live counts shown next to a sidebar entry (see layouts/NavBadge). */
export type NavBadgeKind = 'pendingLinks';

const dashboard = (role: Role, path: string, load: AppRoute['load']): AppRoute => ({
  path,
  roles: [role],
  load,
  nav: { label: 'Dashboard', icon: LayoutDashboard },
});

/**
 * Every role-restricted page, in sidebar order. Routes and the sidebar are both built from this
 * list; later phases add their pages here.
 */
export const APP_ROUTES: AppRoute[] = [
  dashboard(
    ROLES.ADMIN,
    '/admin/dashboard',
    () => import('../features/dashboards/pages/AdminDashboard'),
  ),
  dashboard(
    ROLES.DOCTOR,
    '/doctor/dashboard',
    () => import('../features/dashboards/pages/DoctorDashboard'),
  ),
  dashboard(
    ROLES.RECEPTIONIST,
    '/reception/dashboard',
    () => import('../features/dashboards/pages/ReceptionDashboard'),
  ),
  dashboard(
    ROLES.LABTECH,
    '/lab/dashboard',
    () => import('../features/dashboards/pages/LabDashboard'),
  ),
  dashboard(
    ROLES.PATIENT,
    '/patient/dashboard',
    () => import('../features/dashboards/pages/PatientDashboard'),
  ),
  {
    path: '/reception/appointments',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/appointments/pages/ReceptionAppointmentsPage'),
    nav: { label: 'Appointments', icon: CalendarDays },
  },
  {
    path: '/reception/appointments/:id',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/appointments/pages/AppointmentDetailPage'),
  },
  {
    path: '/reception/queue',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/queue/pages/ReceptionQueuePage'),
    nav: { label: 'Queue', icon: ListOrdered },
  },
  {
    path: '/doctor/queue',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/queue/pages/DoctorQueuePage'),
    nav: { label: 'My queue', icon: ListOrdered },
  },
  {
    path: '/doctor/appointments',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/appointments/pages/DoctorAppointmentsPage'),
    nav: { label: 'Appointments', icon: CalendarDays },
  },
  {
    path: '/doctor/appointments/:id',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/appointments/pages/AppointmentDetailPage'),
  },
  {
    path: '/doctor/patients',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/doctorPatients/pages/MyPatientsPage'),
    nav: { label: 'My patients', icon: UserRound },
  },
  {
    path: '/doctor/patients/:id',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/doctorPatients/pages/DoctorPatientPage'),
  },
  {
    path: '/doctor/notes',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/doctorPatients/pages/NotesPage'),
    nav: { label: 'Notes', icon: FileText },
  },
  {
    path: '/doctor/consult/:appointmentId',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/encounters/pages/ConsultWorkspacePage'),
  },
  {
    path: '/doctor/encounters/:id',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/encounters/pages/EncounterPage'),
  },

  {
    path: '/patient/appointments',
    roles: [ROLES.PATIENT],
    load: () => import('../features/appointments/pages/MyAppointmentsPage'),
    nav: { label: 'Appointments', icon: CalendarDays },
  },
  {
    path: '/patient/appointments/book',
    roles: [ROLES.PATIENT],
    load: () => import('../features/appointments/pages/BookAppointmentPage'),
  },
  {
    path: '/admin/appointments',
    roles: [ROLES.ADMIN],
    load: () => import('../features/appointments/pages/AdminAppointmentsPage'),
    nav: { label: 'Appointments', icon: CalendarDays },
  },
  {
    path: '/admin/appointments/:id',
    roles: [ROLES.ADMIN],
    load: () => import('../features/appointments/pages/AppointmentDetailPage'),
  },
  {
    path: '/reception/patients',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/patients/pages/PatientsPage'),
    nav: { label: 'Patients', icon: UserRound },
  },
  {
    path: '/reception/patients/new',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/patients/pages/NewPatientPage'),
  },
  {
    path: '/reception/patients/:id',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/patients/pages/PatientDetailPage'),
  },
  {
    path: '/reception/pending-links',
    roles: [ROLES.RECEPTIONIST],
    load: () => import('../features/patients/pages/PendingLinksPage'),
    nav: { label: 'Pending verifications', icon: ShieldCheck, badge: 'pendingLinks' },
  },
  {
    path: '/patient/profile',
    roles: [ROLES.PATIENT],
    load: () => import('../features/patients/pages/MyPatientProfilePage'),
    nav: { label: 'My details', icon: UserRound },
  },
  {
    path: '/patient/verify-identity',
    roles: [ROLES.PATIENT],
    load: () => import('../features/patients/pages/PendingVerificationPage'),
  },
  {
    path: '/admin/users',
    roles: [ROLES.ADMIN],
    load: () => import('../features/users/pages/UsersPage'),
    nav: { label: 'Users', icon: Users },
  },
  {
    path: '/admin/users/:id',
    roles: [ROLES.ADMIN],
    load: () => import('../features/users/pages/UserDetailPage'),
  },
  {
    path: '/admin/patients',
    roles: [ROLES.ADMIN],
    load: () => import('../features/patients/pages/PatientsPage'),
    nav: { label: 'Patients', icon: UserRound },
  },
  {
    path: '/admin/patients/:id',
    roles: [ROLES.ADMIN],
    load: () => import('../features/patients/pages/PatientDetailPage'),
  },
  {
    path: '/admin/departments',
    roles: [ROLES.ADMIN],
    load: () => import('../features/departments/pages/DepartmentsPage'),
    nav: { label: 'Departments', icon: Building2 },
  },
  {
    path: '/admin/services',
    roles: [ROLES.ADMIN],
    load: () => import('../features/services/pages/ServicesPage'),
    nav: { label: 'Services', icon: Receipt },
  },
  {
    path: '/admin/doctors',
    roles: [ROLES.ADMIN],
    load: () => import('../features/doctors/pages/DoctorsPage'),
    nav: { label: 'Doctors', icon: Stethoscope },
  },
  {
    path: '/admin/doctors/:id',
    roles: [ROLES.ADMIN],
    load: () => import('../features/doctors/pages/DoctorDetailPage'),
  },
  {
    path: '/admin/lab-tests',
    roles: [ROLES.ADMIN],
    load: () => import('../features/labTests/pages/LabTestsPage'),
    nav: { label: 'Lab tests', icon: FlaskConical },
  },
  {
    path: '/admin/lab-tests/new',
    roles: [ROLES.ADMIN],
    load: () => import('../features/labTests/pages/LabTestEditorPage'),
  },
  {
    path: '/admin/lab-tests/:id',
    roles: [ROLES.ADMIN],
    load: () => import('../features/labTests/pages/LabTestEditorPage'),
  },
  {
    path: '/admin/audit-logs',
    roles: [ROLES.ADMIN],
    load: () => import('../features/audit/pages/AuditLogsPage'),
    nav: { label: 'Audit logs', icon: ScrollText },
  },
  {
    path: '/doctor/schedule',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/doctors/pages/MySchedulePage'),
    nav: { label: 'My schedule', icon: CalendarClock },
  },
  {
    path: '/doctor/profile',
    roles: [ROLES.DOCTOR],
    load: () => import('../features/doctors/pages/MyDoctorProfilePage'),
    nav: { label: 'My doctor profile', icon: IdCard },
  },
  {
    path: '/admin/settings',
    roles: [ROLES.ADMIN],
    load: () => import('../features/settings/pages/SettingsPage'),
    nav: { label: 'Settings', icon: Settings },
  },
];

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: NavBadgeKind;
}

/** Sidebar items for a role, from APP_ROUTES. */
export function navItemsFor(role: Role): NavItem[] {
  return APP_ROUTES.filter((r) => r.nav && r.roles.includes(role)).map((r) => ({
    label: r.nav!.label,
    icon: r.nav!.icon,
    to: r.path,
    ...(r.nav!.badge ? { badge: r.nav!.badge } : {}),
  }));
}
