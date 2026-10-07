import { ROLE_VALUES, type Role } from '../../src/config/constants.js';
import { config } from '../../src/config/env.js';
import { addDaysToDate, clinicToday } from '../../src/utils/dates.js';
import type { LoggedIn } from './auth.js';
import { TEST_PASSWORD } from './auth.js';

/**
 * RBAC matrix rows (spec §2.4, §15.1): every protected endpoint with the roles allowed and the
 * exact status an allowed role gets (the request is built to be valid). Used by rbac.test.ts
 * (every role × every row) and routeInventory.test.ts (every mounted route must have a row).
 *
 * Adding an endpoint: add one row here. `path` builds a valid URL from the context; `body` a
 * valid body. Routes with `:id` use the ids in Ctx (extend Ctx and buildContext if you need
 * another fixture).
 */

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Ctx {
  me: LoggedIn;
  /** An active staff user the admin endpoints act on. */
  targetId: string;
  /** An inactive staff user (for activate). */
  inactiveId: string;
  /** Another session of the caller (for DELETE /auth/sessions/:id). */
  otherSessionId: string;
  /** An active and an inactive department. */
  departmentId: string;
  inactiveDepartmentId: string;
  /** An active and an inactive service. */
  serviceId: string;
  inactiveServiceId: string;
  /** A doctor with a profile: the caller when the caller is a doctor ("own" rows). */
  doctorId: string;
  /** Another doctor with a profile ("not own" rows). */
  otherDoctorId: string;
  /** Future leave of `doctorId`. */
  leaveId: string;
  /** An active and an inactive lab test. */
  labTestId: string;
  inactiveLabTestId: string;
  /** A patient the caller may open: their own record when the caller is a patient. */
  patientId: string;
  /** Another patient (not the caller's own). */
  otherPatientId: string;
  /** An inactive patient (for activate). */
  inactivePatientId: string;
  /** A patient with an email and no portal account (for portal-invite). */
  invitablePatientId: string;
  /** A self-registered user waiting for verification against `pendingPatientId`. */
  pendingUserId: string;
  pendingPatientId: string;
  /**
   * A scheduled appointment of `patientId` with `doctorId` (own for a doctor or patient caller),
   * days ahead; `doctorId` works 09:00–13:00 every day and `serviceId` is bookable.
   */
  appointmentId: string;
  /** Clinic date of the appointment, and free slots for booking and rescheduling. */
  appointmentDate: string;
  bookStartAt: string;
  rescheduleStartAt: string;
  /**
   * Today's appointments of `doctorId` (clinic time): scheduled and already started (check-in,
   * no-show), checked in (start, priority, call-next; the patient is `patientId`), no-show (undo),
   * and yesterday's still in consultation (complete). `queueAppointmentId` = `checkedInId` for
   * the /queue/:appointmentId routes.
   */
  todayScheduledId: string;
  checkedInId: string;
  queueAppointmentId: string;
  noShowId: string;
  inConsultationId: string;
  /** A patient with no appointments (walk-in). */
  walkInPatientId: string;
  /** The draft encounter of `inConsultationId` (doctorId's; its documentation window is open). */
  encounterId: string;
  /** A draft note of doctorId (another appointment in consultation) ready to sign, revision 0. */
  signableEncounterId: string;
  /**
   * A signed note of doctorId with patientId (a completed appointment), with an issued
   * prescription `prescriptionId` (patientId's own for a patient caller).
   */
  signedEncounterId: string;
  prescriptionId: string;
  /** A reissued draft prescription (replaces a cancelled one) on another signed note. */
  reissuedDraftId: string;
  /** A draft lab order of doctorId on `encounterId` (its note is a draft, window open). */
  draftLabOrderId: string;
  /** A placed ('ordered') lab order of doctorId for patientId with two pending items. */
  labOrderId: string;
  labItemId: string;
  /** A released lab order of doctorId for patientId (the patient's own). */
  releasedLabOrderId: string;
  releasedLabItemId: string;
  /**
   * Lab orders of doctorId in each workflow status (step 2). Results were entered, and pending
   * revisions made, by another lab technician (`targetId`), so the caller may verify them.
   */
  collectedLabOrderId: string;
  rejectedLabOrderId: string;
  processingLabOrderId: string;
  processingLabItemId: string;
  enteredLabOrderId: string;
  verifiedLabOrderId: string;
  revisionLabOrderId: string;
  revisionLabItemId: string;
  /**
   * A generated lab report of patientId (visible to the patient, file in storage); it is also
   * the report of `releasedLabOrderId`.
   */
  documentId: string;
  /** A document the caller uploaded just now (category 'other'), for delete. */
  myDocumentId: string;
  /** Invoices of patientId (Phase 7): a manual draft (revision 0) and an unpaid issued one. */
  draftInvoiceId: string;
  issuedInvoiceId: string;
  /** A partly paid invoice of patientId and its cash payment (refundable). */
  paidInvoiceId: string;
  paymentId: string;
  /** Unique per test (for POST /users). */
  n: number;
}

export interface Row {
  method: Method;
  path: (c: Ctx) => string;
  body?: (c: Ctx) => object;
  /** A multipart/form-data request instead of a JSON body (uploads). */
  multipart?: (c: Ctx) => { fields: Record<string, string>; file: Buffer; filename: string };
  roles: readonly Role[];
  status: number;
  /**
   * Allowed roles that get another status: roles that pass `authorize` but are stopped by the
   * patient-access policy (404, spec §10.2).
   */
  statusFor?: Partial<Record<Role, number>>;
}

export const ALL = ROLE_VALUES;
export const ADMIN: readonly Role[] = ['admin'];
const ADMIN_DOCTOR: readonly Role[] = ['admin', 'doctor'];
const ADMIN_DOCTOR_RECEPTION: readonly Role[] = ['admin', 'doctor', 'receptionist'];
const ADMIN_RECEPTION: readonly Role[] = ['admin', 'receptionist'];
const DOCTOR: readonly Role[] = ['doctor'];
const PATIENT: readonly Role[] = ['patient'];
const RECEPTION: readonly Role[] = ['receptionist'];
const PATIENT_READERS: readonly Role[] = ['admin', 'receptionist', 'doctor', 'patient'];
const INVOICE_READERS: readonly Role[] = ['admin', 'receptionist', 'patient'];
const APPOINTMENT_BOOKERS: readonly Role[] = ['admin', 'receptionist', 'patient'];
const RECEPTION_ONLY: readonly Role[] = ['receptionist'];
const PRESCRIPTION_READERS: readonly Role[] = ['doctor', 'patient', 'receptionist'];
const LAB_ORDER_READERS: readonly Role[] = ['doctor', 'labtech', 'receptionist', 'patient'];
const DOCTOR_LABTECH: readonly Role[] = ['doctor', 'labtech'];
const LABTECH: readonly Role[] = ['labtech'];
const DOCUMENT_UPLOADERS: readonly Role[] = ['doctor', 'receptionist', 'labtech', 'patient'];
/** A category each uploading role may use for `patientId`. */
const UPLOAD_CATEGORY: Partial<Record<Role, string>> = {
  doctor: 'referral',
  receptionist: 'id_proof',
  labtech: 'lab_report',
  patient: 'other',
};
/** A minimal valid PDF (uploads are checked on their bytes). */
export const MATRIX_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'latin1',
);

/** A clinic date `days` from today (clinic timezone = the settings default). */
const clinicDay = (days: number) => addDaysToDate(clinicToday('Asia/Kolkata'), days);
const WEEK = [{ weekday: 1, sessions: [{ start: '09:00', end: '13:00' }] }];

/** 1 → 'A', 27 → 'AA': unique letter-only suffixes (department codes are letters only). */
export const letters = (n: number): string =>
  (n > 26 ? letters(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

export const ENDPOINTS: Row[] = [
  // Auth (any logged-in user)
  { method: 'get', path: () => '/auth/me', roles: ALL, status: 200 },
  {
    method: 'patch',
    path: () => '/auth/me',
    body: () => ({ firstName: 'Changed' }),
    roles: ALL,
    status: 200,
  },
  { method: 'get', path: () => '/auth/sessions', roles: ALL, status: 200 },
  { method: 'delete', path: (c) => `/auth/sessions/${c.otherSessionId}`, roles: ALL, status: 200 },
  {
    method: 'post',
    path: () => '/auth/change-password',
    body: () => ({ currentPassword: TEST_PASSWORD, newPassword: 'Matrix-2026x' }),
    roles: ALL,
    status: 200,
  },
  { method: 'post', path: () => '/auth/logout-all', roles: ALL, status: 200 },
  { method: 'post', path: () => '/auth/logout', roles: ALL, status: 200 },
  // Users (admin)
  { method: 'get', path: () => '/users', roles: ADMIN, status: 200 },
  {
    method: 'post',
    path: () => '/users',
    body: (c) => ({
      firstName: 'New',
      lastName: 'Staff',
      email: `new${c.n}@clinic.dev`,
      role: 'labtech',
    }),
    roles: ADMIN,
    status: 201,
  },
  { method: 'get', path: (c) => `/users/${c.targetId}`, roles: ADMIN, status: 200 },
  {
    method: 'patch',
    path: (c) => `/users/${c.targetId}`,
    body: () => ({ firstName: 'X' }),
    roles: ADMIN,
    status: 200,
  },
  { method: 'post', path: (c) => `/users/${c.targetId}/deactivate`, roles: ADMIN, status: 200 },
  { method: 'post', path: (c) => `/users/${c.inactiveId}/activate`, roles: ADMIN, status: 200 },
  { method: 'post', path: (c) => `/users/${c.targetId}/reset-password`, roles: ADMIN, status: 200 },
  { method: 'post', path: (c) => `/users/${c.targetId}/unlock`, roles: ADMIN, status: 200 },
  // Audit logs (admin)
  { method: 'get', path: () => '/audit-logs', roles: ADMIN, status: 200 },
  { method: 'get', path: () => '/audit-logs/verify', roles: ADMIN, status: 200 },
  // Settings (admin; GET /settings/public is in PUBLIC_ENDPOINTS)
  { method: 'get', path: () => '/settings', roles: ADMIN, status: 200 },
  {
    method: 'patch',
    path: () => '/settings',
    body: (c) => ({ tagline: `Matrix ${c.n}` }),
    roles: ADMIN,
    status: 200,
  },
  // Departments (writes admin; reads public)
  {
    method: 'post',
    path: () => '/departments',
    body: (c) => ({ name: `Matrix ${c.n}`, code: `MX${letters(c.n)}` }),
    roles: ADMIN,
    status: 201,
  },
  {
    method: 'patch',
    path: (c) => `/departments/${c.departmentId}`,
    body: () => ({ description: 'Changed' }),
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/departments/${c.departmentId}/deactivate`,
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/departments/${c.inactiveDepartmentId}/activate`,
    roles: ADMIN,
    status: 200,
  },
  // Services (writes admin; reads public)
  {
    method: 'post',
    path: () => '/services',
    body: (c) => ({ code: `SVC-${c.n}`, name: 'Matrix service', type: 'other', pricePaise: 100 }),
    roles: ADMIN,
    status: 201,
  },
  {
    method: 'patch',
    path: (c) => `/services/${c.serviceId}`,
    body: () => ({ pricePaise: 12_345 }),
    roles: ADMIN,
    status: 200,
  },
  { method: 'post', path: (c) => `/services/${c.serviceId}/deactivate`, roles: ADMIN, status: 200 },
  {
    method: 'post',
    path: (c) => `/services/${c.inactiveServiceId}/activate`,
    roles: ADMIN,
    status: 200,
  },
  // Doctors (spec §7.6). "Own" rows use the caller as the doctor when the caller is a doctor;
  // "other" rows show a doctor cannot act on another doctor.
  {
    method: 'post',
    path: () => '/doctors',
    body: (c) => ({
      firstName: 'Matrix',
      lastName: 'Doctor',
      email: `matrix.dr${c.n}@clinic.dev`,
      department: c.departmentId,
      specialization: 'General Physician',
      registrationNumber: `MX-${c.n}`,
    }),
    roles: ADMIN,
    status: 201,
  },
  {
    method: 'patch',
    path: (c) => `/doctors/${c.doctorId}`,
    body: () => ({ bio: 'Matrix bio' }),
    roles: ADMIN_DOCTOR,
    status: 200,
  },
  {
    method: 'patch',
    path: (c) => `/doctors/${c.otherDoctorId}`,
    body: () => ({ bio: 'Matrix bio' }),
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/doctors/${c.doctorId}/schedule`,
    roles: ADMIN_DOCTOR_RECEPTION,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/doctors/${c.otherDoctorId}/schedule`,
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'put',
    path: (c) => `/doctors/${c.doctorId}/schedule`,
    body: () => ({ effectiveFrom: clinicDay(1), days: WEEK }),
    roles: ADMIN_DOCTOR,
    status: 200,
  },
  {
    method: 'put',
    path: (c) => `/doctors/${c.otherDoctorId}/schedule`,
    body: () => ({ effectiveFrom: clinicDay(1), days: WEEK }),
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/doctors/${c.doctorId}/leaves`,
    roles: ADMIN_DOCTOR_RECEPTION,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/doctors/${c.otherDoctorId}/leaves`,
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/doctors/${c.doctorId}/leaves`,
    body: () => ({ date: clinicDay(14), fullDay: true }),
    roles: ADMIN_DOCTOR,
    status: 201,
  },
  {
    method: 'post',
    path: (c) => `/doctors/${c.otherDoctorId}/leaves`,
    body: () => ({ date: clinicDay(14), fullDay: true }),
    roles: ADMIN,
    status: 201,
  },
  {
    method: 'post',
    path: (c) => `/doctors/${c.doctorId}/leaves/${c.leaveId}/cancel`,
    roles: ADMIN_DOCTOR,
    status: 200,
  },
  // Lab test catalogue (spec §7.14): reads for any logged-in user, writes admin
  { method: 'get', path: () => '/lab-tests', roles: ALL, status: 200 },
  { method: 'get', path: (c) => `/lab-tests/${c.labTestId}`, roles: ALL, status: 200 },
  {
    method: 'post',
    path: () => '/lab-tests',
    body: (c) => ({
      code: `LT-${c.n}`,
      name: 'Matrix test',
      category: 'other',
      sampleType: 'blood',
      pricePaise: 100,
      parameters: [{ key: 'value', name: 'Value', valueType: 'text' }],
    }),
    roles: ADMIN,
    status: 201,
  },
  {
    method: 'patch',
    path: (c) => `/lab-tests/${c.labTestId}`,
    body: () => ({ pricePaise: 4_321 }),
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-tests/${c.labTestId}/deactivate`,
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-tests/${c.inactiveLabTestId}/activate`,
    roles: ADMIN,
    status: 200,
  },
];

ENDPOINTS.push(
  // Patients (spec §7.7). Doctors see patients they have a care relationship with – patientId,
  // not otherPatientId (404); patients may open only their own record (others → 404).
  { method: 'get', path: () => '/patients', roles: ADMIN_DOCTOR_RECEPTION, status: 200 },
  {
    method: 'get',
    path: () => '/patients/check-duplicate?phone=9876543210&dateOfBirth=1985-06-15',
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'post',
    path: () => '/patients',
    body: (c) => ({
      firstName: 'Matrix',
      lastName: `Row${letters(c.n)}`,
      dateOfBirth: '1990-01-01',
      gender: 'male',
      phone: `+9197${String(c.n).padStart(8, '0')}`,
      consent: { dataProcessing: true },
    }),
    roles: ADMIN_RECEPTION,
    status: 201,
  },
  { method: 'get', path: () => '/patients/me', roles: PATIENT, status: 200 },
  {
    method: 'patch',
    path: () => '/patients/me',
    body: () => ({ preferredLanguage: 'hi' }),
    roles: PATIENT,
    status: 200,
  },
  { method: 'get', path: () => '/patients/pending-links', roles: ADMIN_RECEPTION, status: 200 },
  {
    method: 'post',
    path: (c) => `/patients/${c.invitablePatientId}/portal-invite`,
    roles: ADMIN_RECEPTION,
    status: 201,
  },
  {
    method: 'post',
    path: (c) => `/patients/${c.pendingPatientId}/confirm-link`,
    body: (c) => ({ userId: c.pendingUserId }),
    roles: RECEPTION,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/patients/${c.pendingPatientId}/reject-link`,
    body: (c) => ({ userId: c.pendingUserId, reason: 'Different person (twin)' }),
    roles: RECEPTION,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/patients/${c.patientId}`,
    roles: PATIENT_READERS,
    status: 200, // the doctor has appointments with patientId (care relationship)
  },
  {
    method: 'get',
    path: (c) => `/patients/${c.otherPatientId}`,
    roles: PATIENT_READERS,
    status: 200,
    statusFor: { doctor: 404, patient: 404 },
  },
  {
    method: 'patch',
    path: (c) => `/patients/${c.patientId}`,
    body: (c) => ({ adminNotes: `Matrix note ${c.n}` }),
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'patch',
    path: (c) => `/patients/${c.patientId}/clinical-profile`,
    body: () => ({ chronicConditions: [{ name: 'Asthma' }] }),
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'patch',
    path: (c) => `/patients/${c.otherPatientId}/clinical-profile`,
    body: () => ({ chronicConditions: [{ name: 'Asthma' }] }),
    roles: DOCTOR,
    status: 404, // no care relationship with otherPatientId
  },
  {
    method: 'post',
    path: (c) => `/patients/${c.patientId}/deactivate`,
    body: () => ({ reason: 'Moved away' }),
    roles: ADMIN,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/patients/${c.inactivePatientId}/activate`,
    body: () => ({ reason: 'Returned' }),
    roles: ADMIN,
    status: 200,
  },
);

ENDPOINTS.push(
  // Appointments (spec §7.8). Doctors and patients act on their own appointment (the context's).
  { method: 'get', path: () => '/appointments', roles: PATIENT_READERS, status: 200 },
  {
    method: 'get',
    path: (c) => `/appointments/calendar?from=${c.appointmentDate}&to=${c.appointmentDate}`,
    roles: ADMIN_DOCTOR_RECEPTION,
    status: 200,
  },
  {
    method: 'post',
    path: () => '/appointments',
    body: (c) => ({
      patientId: c.patientId,
      doctorId: c.doctorId,
      serviceId: c.serviceId,
      startAt: c.bookStartAt,
    }),
    roles: APPOINTMENT_BOOKERS,
    status: 201,
  },
  {
    method: 'get',
    path: (c) => `/appointments/${c.appointmentId}`,
    roles: PATIENT_READERS,
    status: 200,
  },
  {
    method: 'patch',
    path: (c) => `/appointments/${c.appointmentId}`,
    body: (c) => ({ priority: 'priority', reason: `Matrix ${c.n}` }),
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.appointmentId}/reschedule`,
    body: (c) => ({ startAt: c.rescheduleStartAt, reason: 'Matrix reschedule' }),
    roles: APPOINTMENT_BOOKERS,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.appointmentId}/cancel`,
    body: () => ({ reason: 'Matrix cancel' }),
    roles: PATIENT_READERS,
    status: 200,
  },
  {
    method: 'post',
    path: () => '/appointments/walk-in',
    body: (c) => ({ patientId: c.walkInPatientId, doctorId: c.doctorId, serviceId: c.serviceId }),
    roles: RECEPTION_ONLY,
    status: 201,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.todayScheduledId}/check-in`,
    roles: RECEPTION_ONLY,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.checkedInId}/start`,
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.inConsultationId}/complete`,
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.todayScheduledId}/no-show`,
    roles: RECEPTION_ONLY,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/appointments/${c.noShowId}/undo-no-show`,
    roles: RECEPTION_ONLY,
    status: 200,
  },
  // Queue (spec §7.9); GET /queue/board is in PUBLIC_ENDPOINTS
  {
    method: 'get',
    path: (c) => `/queue?doctor=${c.doctorId}`,
    roles: ADMIN_DOCTOR_RECEPTION,
    status: 200,
  },
  { method: 'post', path: () => '/queue/call-next', roles: DOCTOR, status: 200 },
  {
    method: 'post',
    path: (c) => `/queue/${c.queueAppointmentId}/priority`,
    body: () => ({ priority: 'emergency', reason: 'Matrix priority' }),
    roles: RECEPTION_ONLY,
    status: 200,
  },
  { method: 'get', path: () => '/queue/my-position', roles: PATIENT, status: 200 },
  // Encounters (spec §7.10) and the formulary: doctors only; admins and receptionists never.
  {
    method: 'get',
    path: (c) => `/appointments/${c.inConsultationId}/encounter`,
    roles: DOCTOR,
    status: 200,
  },
  { method: 'get', path: () => '/encounters', roles: DOCTOR, status: 200 },
  { method: 'get', path: (c) => `/encounters/${c.encounterId}`, roles: DOCTOR, status: 200 },
  {
    method: 'patch',
    path: (c) => `/encounters/${c.encounterId}`,
    body: (c) => ({ expectedVersion: 0, plan: `Matrix plan ${c.n}` }),
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/encounters/${c.signableEncounterId}/sign`,
    body: () => ({ expectedVersion: 0 }),
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/encounters/${c.signedEncounterId}/amendments`,
    body: (c) => ({ reason: 'Matrix amendment reason', changes: { plan: `Plan ${c.n}` } }),
    roles: DOCTOR,
    status: 201,
  },
  {
    method: 'get',
    path: (c) => `/encounters/${c.signedEncounterId}/amendments`,
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'put',
    path: (c) => `/encounters/${c.encounterId}/prescription`,
    body: () => ({
      items: [
        {
          drugName: 'Paracetamol',
          dose: '1 tablet',
          frequency: 'TDS',
          durationDays: 3,
        },
      ],
    }),
    roles: DOCTOR,
    status: 200,
  },
  { method: 'get', path: () => '/formulary?q=para', roles: DOCTOR, status: 200 },
  // Prescriptions (spec §7.12): doctors, patients (own issued) and reception (print); never admin.
  {
    method: 'get',
    path: (c) => `/prescriptions?patient=${c.patientId}`,
    roles: PRESCRIPTION_READERS,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/prescriptions/${c.prescriptionId}`,
    roles: PRESCRIPTION_READERS,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/prescriptions/${c.prescriptionId}/print`,
    roles: PRESCRIPTION_READERS,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/prescriptions/${c.prescriptionId}/cancel`,
    body: () => ({ reason: 'Matrix cancel reason' }),
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/prescriptions/${c.prescriptionId}/reissue`,
    body: () => ({ reason: 'Matrix reissue reason' }),
    roles: DOCTOR,
    status: 201,
  },
  {
    method: 'post',
    path: (c) => `/prescriptions/${c.reissuedDraftId}/issue`,
    roles: DOCTOR,
    status: 200,
  },
  // Lab orders (spec §7.14): doctors order; lab techs, doctors, reception (status) and patients
  // (own released) read; admins never.
  {
    method: 'get',
    path: (c) => `/lab-orders?patient=${c.patientId}`,
    roles: LAB_ORDER_READERS,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/lab-orders/${c.releasedLabOrderId}`,
    roles: LAB_ORDER_READERS,
    status: 200,
  },
  {
    method: 'post',
    path: () => '/lab-orders',
    body: (c) => ({ encounterId: c.encounterId, testIds: [c.labTestId] }),
    roles: DOCTOR,
    status: 201,
  },
  {
    method: 'patch',
    path: (c) => `/lab-orders/${c.draftLabOrderId}`,
    body: () => ({ priority: 'urgent' }),
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.draftLabOrderId}/discard`,
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.labOrderId}/cancel`,
    body: () => ({ reason: 'Matrix cancel' }),
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.labOrderId}/items/${c.labItemId}/cancel`,
    body: () => ({ reason: 'Reagent unavailable' }),
    roles: DOCTOR_LABTECH,
    status: 200,
  },
  // Lab workflow (spec §4.8): lab technicians; the doctor acknowledges results.
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.labOrderId}/collect-sample`,
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.collectedLabOrderId}/reject-sample`,
    body: () => ({ reason: 'Haemolysed' }),
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.rejectedLabOrderId}/recollect`,
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.collectedLabOrderId}/start-processing`,
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'put',
    path: (c) => `/lab-orders/${c.processingLabOrderId}/items/${c.processingLabItemId}/results`,
    body: () => ({ results: [{ parameterKey: 'hb', value: 14 }] }),
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.enteredLabOrderId}/verify`,
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.enteredLabOrderId}/send-back`,
    body: () => ({ reason: 'Check the values' }),
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.verifiedLabOrderId}/release`,
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.releasedLabOrderId}/items/${c.releasedLabItemId}/revise`,
    body: () => ({ results: [], reason: 'Matrix revision reason' }),
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.revisionLabOrderId}/items/${c.revisionLabItemId}/verify-revision`,
    roles: LABTECH,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/lab-orders/${c.releasedLabOrderId}/acknowledge`,
    roles: DOCTOR,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/lab-orders/${c.releasedLabOrderId}/report.pdf`,
    roles: ['doctor', 'labtech', 'patient'],
    status: 200,
  },
  // Documents (spec §7.16): uploads per role and category; admins see metadata and delete.
  {
    method: 'post',
    path: () => '/documents',
    multipart: (c) => ({
      fields: {
        patientId: c.patientId,
        category: UPLOAD_CATEGORY[c.me.user.role as Role] ?? 'other',
        title: 'Matrix upload',
      },
      file: MATRIX_PDF,
      filename: 'matrix.pdf',
    }),
    roles: DOCUMENT_UPLOADERS,
    status: 201,
  },
  {
    method: 'get',
    path: (c) => `/documents?patient=${c.patientId}`,
    roles: ALL,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/documents/${c.documentId}`,
    roles: ALL,
    status: 200,
    statusFor: { receptionist: 404 }, // lab reports are clinical
  },
  {
    method: 'get',
    path: (c) => `/documents/${c.documentId}/download`,
    roles: DOCUMENT_UPLOADERS,
    status: 200,
    statusFor: { receptionist: 404 },
  },
  {
    method: 'post',
    path: (c) => `/documents/${c.myDocumentId}/delete`,
    body: () => ({ reason: 'Matrix delete' }),
    roles: ALL,
    status: 200,
  },
  // Invoices (spec §7.15, Phase 7): reception and admins manage; patients read their own issued
  // invoices; doctors and lab technicians have no billing access.
  { method: 'get', path: () => '/invoices', roles: INVOICE_READERS, status: 200 },
  {
    method: 'post',
    path: () => '/invoices',
    body: (c) => ({
      patientId: c.patientId,
      items: [{ kind: 'other', description: 'Matrix line', unitPricePaise: 1000 }],
    }),
    roles: ADMIN_RECEPTION,
    status: 201,
  },
  {
    method: 'get',
    path: (c) => `/invoices/${c.issuedInvoiceId}`,
    roles: INVOICE_READERS,
    status: 200,
  },
  {
    method: 'patch',
    path: (c) => `/invoices/${c.draftInvoiceId}`,
    body: () => ({ expectedVersion: 0, notes: 'Matrix note' }),
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/invoices/${c.draftInvoiceId}/issue`,
    body: () => ({ expectedVersion: 0 }),
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/invoices/${c.paidInvoiceId}/pdf`,
    roles: INVOICE_READERS,
    status: 200,
  },
  {
    method: 'get',
    path: (c) => `/invoices/${c.paidInvoiceId}/payments`,
    roles: INVOICE_READERS,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/invoices/${c.issuedInvoiceId}/payments`,
    body: () => ({ amountPaise: 100, method: 'cash' }),
    roles: RECEPTION,
    status: 201,
  },
  { method: 'get', path: () => '/payments/summary', roles: ADMIN_RECEPTION, status: 200 },
  {
    method: 'post',
    path: (c) => `/payments/${c.paymentId}/refund`,
    body: () => ({ amountPaise: 100, reason: 'Matrix refund reason' }),
    roles: ADMIN_RECEPTION,
    status: 201,
  },
  {
    method: 'get',
    path: (c) => `/payments/${c.paymentId}/receipt.pdf`,
    roles: INVOICE_READERS,
    status: 200,
  },
  {
    method: 'post',
    path: (c) => `/invoices/${c.issuedInvoiceId}/void`,
    body: () => ({ reason: 'Matrix void' }),
    roles: ADMIN_RECEPTION,
    status: 200,
  },
  // Slots and availability (spec §7.6): any logged-in user
  {
    method: 'get',
    path: (c) => `/doctors/${c.doctorId}/slots?date=${c.appointmentDate}`,
    roles: ALL,
    status: 200,
  },
  {
    method: 'get',
    path: (c) =>
      `/doctors/${c.doctorId}/availability?from=${c.appointmentDate}&to=${c.appointmentDate}`,
    roles: ALL,
    status: 200,
  },
);

/**
 * Public reads (no token needed). rbac.test.ts checks every role and an anonymous caller get
 * `status`; routeInventory.test.ts checks each is in its PUBLIC list.
 */
export const PUBLIC_ENDPOINTS: Row[] = [
  { method: 'get', path: () => '/settings/public', roles: ALL, status: 200 },
  { method: 'get', path: () => '/departments', roles: ALL, status: 200 },
  { method: 'get', path: (c) => `/departments/${c.departmentId}`, roles: ALL, status: 200 },
  { method: 'get', path: () => '/services', roles: ALL, status: 200 },
  { method: 'get', path: (c) => `/services/${c.serviceId}`, roles: ALL, status: 200 },
  { method: 'get', path: () => '/doctors', roles: ALL, status: 200 },
  { method: 'get', path: (c) => `/doctors/${c.doctorId}`, roles: ALL, status: 200 },
  // Queue board: public with the kiosk key (spec §7.9)
  {
    method: 'get',
    path: () => `/queue/board?key=${encodeURIComponent(config.kiosk.key ?? '')}`,
    roles: ALL,
    status: 200,
  },
];

/** Placeholder context: turns a row's `path` into the Express pattern (`/users/:id`). */
export const PATTERN_CTX = {
  targetId: ':id',
  inactiveId: ':id',
  otherSessionId: ':id',
  departmentId: ':id',
  inactiveDepartmentId: ':id',
  serviceId: ':id',
  inactiveServiceId: ':id',
  doctorId: ':id',
  otherDoctorId: ':id',
  leaveId: ':leaveId',
  labTestId: ':id',
  inactiveLabTestId: ':id',
  patientId: ':id',
  otherPatientId: ':id',
  inactivePatientId: ':id',
  invitablePatientId: ':id',
  pendingUserId: ':userId',
  pendingPatientId: ':id',
  appointmentId: ':id',
  appointmentDate: '',
  bookStartAt: '',
  rescheduleStartAt: '',
  todayScheduledId: ':id',
  checkedInId: ':id',
  queueAppointmentId: ':appointmentId',
  noShowId: ':id',
  inConsultationId: ':id',
  walkInPatientId: ':id',
  encounterId: ':id',
  signableEncounterId: ':id',
  signedEncounterId: ':id',
  prescriptionId: ':id',
  reissuedDraftId: ':id',
  draftLabOrderId: ':id',
  labOrderId: ':id',
  labItemId: ':itemId',
  releasedLabOrderId: ':id',
  releasedLabItemId: ':itemId',
  collectedLabOrderId: ':id',
  rejectedLabOrderId: ':id',
  processingLabOrderId: ':id',
  processingLabItemId: ':itemId',
  enteredLabOrderId: ':id',
  verifiedLabOrderId: ':id',
  revisionLabOrderId: ':id',
  revisionLabItemId: ':itemId',
  documentId: ':id',
  myDocumentId: ':id',
  draftInvoiceId: ':id',
  issuedInvoiceId: ':id',
  paidInvoiceId: ':id',
  paymentId: ':id',
  n: 0,
} as unknown as Ctx;

/** "GET /users/:id" for a row (query string dropped). */
export const routeKey = (row: Row) =>
  `${row.method.toUpperCase()} ${row.path(PATTERN_CTX).split('?')[0]}`;
