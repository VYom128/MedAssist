import type { AdminDoctor } from '../src/features/doctors/api';

export const DEPARTMENTS = [
  {
    id: 'gen',
    name: 'General Medicine',
    code: 'GEN',
    description: null,
    isActive: true,
    activeDoctors: 1,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'ped',
    name: 'Paediatrics',
    code: 'PED',
    description: null,
    isActive: true,
    activeDoctors: 1,
    createdAt: null,
    updatedAt: null,
  },
];

export const meta = (n: number) => ({ page: 1, limit: 20, total: n, totalPages: 1 });

export const adminDoctor = (over: Partial<AdminDoctor> = {}): AdminDoctor => ({
  id: 'dr1',
  firstName: 'Anil',
  lastName: 'Mehta',
  name: 'Anil Mehta',
  department: { id: 'gen', name: 'General Medicine', code: 'GEN' },
  specialization: 'General Physician',
  qualifications: ['MBBS', 'MD (Medicine)'],
  experienceYears: 12,
  consultationFeePaise: 50_000,
  languages: ['English', 'Hindi'],
  bio: 'Adult medicine.',
  isAcceptingAppointments: true,
  email: 'dr.mehta@medassist.dev',
  phone: '+919812345670',
  registrationNumber: 'KMC-12345',
  roomNumber: '101',
  slotMinutes: 15,
  isActive: true,
  createdAt: null,
  updatedAt: null,
  ...over,
});
