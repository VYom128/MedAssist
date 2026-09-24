import type { Appointment, CalendarEvent } from '../src/features/appointments/api';
import { addDaysToDate, clinicDate, toUtcFromClinic } from '../src/utils/dates';

/** Server-shaped appointment data for client tests (see server appointments serializer). */

export const TODAY = clinicDate();
export const TOMORROW = addDaysToDate(TODAY, 1);
export const at = (date: string, time: string) => toUtcFromClinic(date, time, 'Asia/Kolkata');

export const DOCTORS = [
  {
    id: 'dr1',
    firstName: 'Anil',
    lastName: 'Mehta',
    name: 'Anil Mehta',
    department: { id: 'dep1', name: 'General Medicine', code: 'GEN' },
    specialization: 'General Physician',
    qualifications: [],
    experienceYears: 10,
    consultationFeePaise: 50_000,
    languages: [],
    bio: null,
    isAcceptingAppointments: true,
  },
  {
    id: 'dr2',
    firstName: 'Kavya',
    lastName: 'Iyer',
    name: 'Kavya Iyer',
    department: { id: 'dep2', name: 'Paediatrics', code: 'PED' },
    specialization: 'Paediatrician',
    qualifications: [],
    experienceYears: 8,
    consultationFeePaise: 60_000,
    languages: [],
    bio: null,
    isAcceptingAppointments: true,
  },
];

export const DEPARTMENTS = [
  { id: 'dep1', name: 'General Medicine', code: 'GEN', description: null },
  { id: 'dep2', name: 'Paediatrics', code: 'PED', description: null },
];

export const SERVICES = [
  {
    id: 'svc1',
    code: 'CONS-GEN',
    name: 'General Medicine consultation',
    department: { id: 'dep1', name: 'General Medicine', code: 'GEN' },
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 50_000,
    taxRateBps: null,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'svc2',
    code: 'CONS-PED',
    name: 'Paediatric consultation',
    department: { id: 'dep2', name: 'Paediatrics', code: 'PED' },
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 60_000,
    taxRateBps: null,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  },
];

export const PATIENT = {
  id: 'p1',
  mrn: 'MRN-000042',
  firstName: 'Priya',
  lastName: 'Sharma',
  fullName: 'Priya Sharma',
  age: 34,
  gender: 'female' as const,
  isActive: true,
  phone: '+919876543210',
  hasPortal: true,
};

export function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    appointmentNumber: 'APT-2026-000045',
    startAt: at(TOMORROW, '09:30'),
    endAt: at(TOMORROW, '09:45'),
    status: 'scheduled',
    type: 'new',
    source: 'reception',
    reason: 'Fever for 3 days',
    doctor: { id: 'dr1', name: 'Anil Mehta' },
    department: { id: 'dep1', name: 'General Medicine' },
    service: {
      id: 'svc1',
      name: 'General Medicine consultation',
      durationMinutes: 15,
      pricePaise: 50_000,
    },
    followUpOf: null,
    tokenNumber: null,
    checkedInAt: null,
    createdAt: null,
    updatedAt: null,
    patient: {
      id: 'p1',
      mrn: 'MRN-000042',
      fullName: 'Priya Sharma',
      age: 34,
      gender: 'female',
      phone: '+919876543210',
    },
    priority: 'normal',
    isOverbook: false,
    queue: {
      tokenNumber: null,
      checkedInAt: null,
      calledAt: null,
      startedAt: null,
      completedAt: null,
    },
    cancellation: null,
    rescheduleHistory: [],
    priorityHistory: [],
    statusHistory: [{ status: 'scheduled', at: at(TODAY, '08:00'), by: 'u1', note: null }],
    bookedBy: 'u1',
    ...overrides,
  };
}

export function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'a1',
    appointmentNumber: 'APT-2026-000045',
    startAt: at(TODAY, '09:30'),
    endAt: at(TODAY, '09:45'),
    status: 'scheduled',
    type: 'new',
    priority: 'normal',
    isOverbook: false,
    doctorId: 'dr1',
    patientShortName: 'Priya S.',
    ...overrides,
  };
}

export const page = (items: unknown[], total = items.length) => ({
  meta: { page: 1, limit: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
  items,
});
