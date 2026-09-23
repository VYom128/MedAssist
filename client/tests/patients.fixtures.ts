import type { Patient, PatientListItem, PendingLink } from '../src/features/patients/api';

export const listItem = (over: Partial<PatientListItem> = {}): PatientListItem => ({
  id: 'p1',
  mrn: 'MRN-000001',
  firstName: 'Priya',
  lastName: 'Sharma',
  fullName: 'Priya Sharma',
  age: 36,
  gender: 'female',
  isActive: true,
  phone: '+919876543210',
  hasPortal: false,
  ...over,
});

/** The receptionist's view of a patient (allergies, no chronic conditions). */
export const receptionView = (over: Partial<Patient> = {}): Patient => ({
  ...listItem(),
  dateOfBirth: '1990-05-17',
  bloodGroup: 'B+',
  email: 'priya@example.com',
  address: { line1: '12 MG Road', city: 'Bengaluru', country: 'India' },
  emergencyContact: { name: 'Ravi Sharma', relation: 'Husband', phone: '+919876500000' },
  preferredLanguage: 'en',
  consent: {
    dataProcessing: { given: true, at: '2026-09-01T05:00:00.000Z' },
    aiExplanations: { given: true, at: '2026-09-01T05:00:00.000Z' },
    communications: { email: true, sms: false },
  },
  registeredAt: '2026-09-01T05:00:00.000Z',
  updatedAt: null,
  insurance: null,
  adminNotes: null,
  allergies: [
    {
      id: 'a1',
      substance: 'Penicillin',
      reaction: 'Rash',
      severity: 'severe',
      recordedBy: 'r1',
      recordedAt: '2026-09-01T05:00:00.000Z',
    },
  ],
  portal: { hasAccount: false, email: null, linkStatus: null, lastLoginAt: null },
  ...over,
});

/** The admin's view: no allergies or chronic conditions (spec §2.5). */
export const adminView = (over: Partial<Patient> = {}): Patient => {
  const { allergies: _allergies, ...rest } = receptionView(over);
  return rest;
};

/** The patient's own view: no admin notes or portal info. */
export const selfView = (over: Partial<Patient> = {}): Patient => {
  const { adminNotes: _notes, portal: _portal, ...rest } = receptionView(over);
  return {
    ...rest,
    chronicConditions: [
      {
        id: 'c1',
        name: 'Asthma',
        since: '2019-03-01',
        notes: null,
        recordedBy: 'd1',
        recordedAt: '2026-09-01T05:00:00.000Z',
      },
    ],
  };
};

export const pendingLink = (over: Partial<PendingLink> = {}): PendingLink => ({
  userId: 'u9',
  isActive: true,
  signup: {
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya.new@example.com',
    phone: '+919876543210',
    dateOfBirth: '1990-05-17',
    registeredAt: '2026-09-20T05:00:00.000Z',
  },
  patient: {
    id: 'p1',
    mrn: 'MRN-000001',
    fullName: 'Priya Sharma',
    dateOfBirth: '1990-05-17',
    phone: '+919876543210',
    isActive: true,
  },
  ...over,
});

export const paged = <T>(items: T[]) => ({
  meta: { page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0 },
});
