import { fakerEN_IN as faker } from '@faker-js/faker';
import type { ServiceType } from '../../config/constants.js';

/**
 * Clinic setup demo data (spec §15.3). Hand-written where the values matter for demos; faker
 * (locale en_IN, fixed seed) fills in names, phones and registration numbers of the other doctors,
 * so every run produces the same clinic.
 */

export const FAKER_SEED = 20_260_923;

/** PATCH-shaped clinic settings (money in paise, taxes in basis points). */
export const CLINIC_SETTINGS = {
  name: 'MedAssist Clinic',
  tagline: 'Family healthcare, close to home',
  registrationNumber: 'KA-BLR-CE-2019-04512',
  gstin: '29AABCM1234F1Z5',
  address: {
    line1: '42, 12th Main Road',
    line2: 'HAL 2nd Stage, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    country: 'India',
  },
  phone: '+918041234567',
  email: 'hello@medassist.dev',
  website: 'https://medassist.dev',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  billing: {
    invoicePrefix: 'INV',
    defaultTaxRateBps: 0, // consultations are GST-exempt
    taxLabel: 'GST',
    paymentMethods: ['cash', 'card', 'upi', 'insurance'] as (
      'cash' | 'card' | 'upi' | 'insurance'
    )[],
    invoiceFooter: 'Thank you for choosing MedAssist Clinic. Get well soon!',
  },
};

export const DEPARTMENTS = [
  {
    code: 'GEN',
    name: 'General Medicine',
    description: 'Adult OPD, fevers, diabetes and blood pressure care',
  },
  { code: 'PED', name: 'Paediatrics', description: 'Care for newborns, children and adolescents' },
  { code: 'DER', name: 'Dermatology', description: 'Skin, hair and nail conditions' },
  {
    code: 'ORT',
    name: 'Orthopaedics',
    description: 'Bones, joints, sports injuries and fractures',
  },
  { code: 'ENT', name: 'ENT', description: 'Ear, nose and throat' },
];

export interface ServiceSeed {
  code: string;
  name: string;
  department: string | null; // department code
  type: ServiceType;
  durationMinutes: number;
  pricePaise: number;
  taxRateBps?: number | null;
}

export const SERVICES: ServiceSeed[] = [
  {
    code: 'CONS-GEN',
    name: 'General Medicine consultation',
    department: 'GEN',
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 50_000,
  },
  {
    code: 'CONS-PED',
    name: 'Paediatric consultation',
    department: 'PED',
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 60_000,
  },
  {
    code: 'CONS-DER',
    name: 'Dermatology consultation',
    department: 'DER',
    type: 'consultation',
    durationMinutes: 20,
    pricePaise: 70_000,
  },
  {
    code: 'CONS-ORT',
    name: 'Orthopaedic consultation',
    department: 'ORT',
    type: 'consultation',
    durationMinutes: 20,
    pricePaise: 90_000,
  },
  {
    code: 'CONS-ENT',
    name: 'ENT consultation',
    department: 'ENT',
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 60_000,
  },
  {
    code: 'FUP-GEN',
    name: 'Follow-up consultation (within 7 days)',
    department: 'GEN',
    type: 'consultation',
    durationMinutes: 10,
    pricePaise: 30_000,
  },
  {
    code: 'FUP-ORT',
    name: 'Orthopaedic follow-up consultation',
    department: 'ORT',
    type: 'consultation',
    durationMinutes: 15,
    pricePaise: 50_000,
  },
  {
    code: 'PROC-DRESS',
    name: 'Wound dressing',
    department: null,
    type: 'procedure',
    durationMinutes: 15,
    pricePaise: 25_000,
    taxRateBps: 1_800,
  },
  {
    code: 'PROC-EARWAX',
    name: 'Ear wax removal',
    department: 'ENT',
    type: 'procedure',
    durationMinutes: 20,
    pricePaise: 50_000,
    taxRateBps: 1_800,
  },
  {
    code: 'PROC-NEB',
    name: 'Nebulisation',
    department: 'PED',
    type: 'procedure',
    durationMinutes: 15,
    pricePaise: 30_000,
    taxRateBps: 1_800,
  },
  {
    code: 'PROC-POP',
    name: 'Plaster of Paris cast application',
    department: 'ORT',
    type: 'procedure',
    durationMinutes: 30,
    pricePaise: 150_000,
    taxRateBps: 1_800,
  },
  {
    code: 'OTH-CERT',
    name: 'Medical fitness certificate',
    department: null,
    type: 'other',
    durationMinutes: 10,
    pricePaise: 20_000,
    taxRateBps: 1_800,
  },
];

type Session = { start: string; end: string };
const MORNING: Session = { start: '09:00', end: '13:00' };
const EVENING: Session = { start: '17:00', end: '20:00' };

/** Weekly template: weekday (0 = Sunday, always off) → sessions. */
export type WeekPlan = Record<number, Session[]>;
const week = (plan: WeekPlan) => plan;

export interface DoctorSeed {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string; // department code
  specialization: string;
  qualifications: string[];
  registrationNumber: string;
  experienceYears: number;
  consultationFeePaise: number;
  roomNumber: string;
  languages: string[];
  bio: string;
  week: WeekPlan;
}

type DoctorPlan = Omit<
  DoctorSeed,
  'firstName' | 'lastName' | 'email' | 'phone' | 'registrationNumber' | 'experienceYears' | 'bio'
> & {
  sex?: 'female' | 'male';
  fixed?: { firstName: string; lastName: string; email: string };
  focus: string;
};

const PLANS: DoctorPlan[] = [
  {
    fixed: { firstName: 'Anil', lastName: 'Mehta', email: 'dr.mehta@medassist.dev' },
    department: 'GEN',
    specialization: 'General Physician',
    qualifications: ['MBBS', 'MD (General Medicine)'],
    consultationFeePaise: 50_000,
    roomNumber: '101',
    languages: ['English', 'Hindi', 'Gujarati'],
    focus: 'diabetes, hypertension and preventive health checks',
    week: week({
      1: [MORNING, EVENING],
      2: [MORNING],
      3: [MORNING, EVENING],
      4: [MORNING],
      5: [MORNING, EVENING],
      6: [MORNING],
    }),
  },
  {
    fixed: { firstName: 'Kavya', lastName: 'Iyer', email: 'dr.iyer@medassist.dev' },
    department: 'PED',
    specialization: 'Paediatrician',
    qualifications: ['MBBS', 'DCH', 'MD (Paediatrics)'],
    consultationFeePaise: 60_000,
    roomNumber: '201',
    languages: ['English', 'Tamil', 'Kannada'],
    focus: 'newborn care, vaccinations and childhood asthma',
    week: week({
      1: [MORNING],
      2: [MORNING, EVENING],
      3: [MORNING],
      4: [MORNING, EVENING],
      5: [MORNING],
      6: [MORNING],
    }),
  },
  {
    sex: 'female',
    department: 'GEN',
    specialization: 'Family Physician',
    qualifications: ['MBBS', 'DNB (Family Medicine)'],
    consultationFeePaise: 45_000,
    roomNumber: '102',
    languages: ['English', 'Hindi', 'Kannada'],
    focus: 'family medicine, thyroid disorders and women’s health',
    week: week({
      1: [EVENING],
      2: [EVENING],
      3: [EVENING],
      4: [EVENING],
      5: [EVENING],
      6: [MORNING],
    }),
  },
  {
    sex: 'male',
    department: 'PED',
    specialization: 'Paediatrician',
    qualifications: ['MBBS', 'MD (Paediatrics)'],
    consultationFeePaise: 55_000,
    roomNumber: '202',
    languages: ['English', 'Hindi', 'Telugu'],
    focus: 'growth and nutrition, and adolescent health',
    week: week({ 1: [EVENING], 2: [EVENING], 3: [EVENING], 4: [EVENING], 5: [EVENING] }),
  },
  {
    sex: 'female',
    department: 'DER',
    specialization: 'Dermatologist',
    qualifications: ['MBBS', 'MD (Dermatology, Venereology & Leprosy)'],
    consultationFeePaise: 70_000,
    roomNumber: '301',
    languages: ['English', 'Hindi', 'Marathi'],
    focus: 'acne, eczema, psoriasis and hair loss',
    week: week({
      1: [MORNING],
      2: [EVENING],
      3: [MORNING],
      4: [EVENING],
      5: [MORNING],
      6: [MORNING],
    }),
  },
  {
    sex: 'male',
    department: 'ORT',
    specialization: 'Orthopaedic Surgeon',
    qualifications: ['MBBS', 'MS (Orthopaedics)'],
    consultationFeePaise: 90_000,
    roomNumber: '401',
    languages: ['English', 'Hindi', 'Kannada'],
    focus: 'joint pain, fractures and knee replacement follow-up',
    week: week({ 1: [MORNING], 2: [MORNING], 3: [MORNING], 4: [MORNING], 5: [MORNING] }),
  },
  {
    sex: 'female',
    department: 'ORT',
    specialization: 'Sports Medicine Specialist',
    qualifications: ['MBBS', 'DNB (Orthopaedics)', 'Fellowship in Sports Medicine'],
    consultationFeePaise: 80_000,
    roomNumber: '402',
    languages: ['English', 'Malayalam'],
    focus: 'sports injuries, back pain and rehabilitation',
    week: week({
      1: [EVENING],
      2: [EVENING],
      3: [EVENING],
      4: [EVENING],
      5: [EVENING],
      6: [MORNING],
    }),
  },
  {
    sex: 'male',
    department: 'ENT',
    specialization: 'ENT Surgeon',
    qualifications: ['MBBS', 'MS (ENT)'],
    consultationFeePaise: 60_000,
    roomNumber: '501',
    languages: ['English', 'Hindi', 'Bengali'],
    focus: 'sinusitis, ear infections and hearing problems',
    week: week({
      1: [MORNING],
      2: [MORNING],
      3: [EVENING],
      4: [MORNING],
      5: [MORNING],
      6: [MORNING],
    }),
  },
];

/** Index (in `doctorSeeds()`) of the doctors who get upcoming leave. */
export const LEAVE_PLAN = { fullDayNextWeek: 0, conferenceThisMonth: 5 };

/**
 * The 8 seeded doctors. Faker is re-seeded on every call, so the result (names, emails, numbers)
 * is identical each time.
 */
export function doctorSeeds(): DoctorSeed[] {
  faker.seed(FAKER_SEED);
  const emails = new Set(PLANS.flatMap((p) => (p.fixed ? [p.fixed.email] : [])));
  const registrations = new Set<string>();

  return PLANS.map(({ sex, fixed, focus, ...plan }) => {
    let person = fixed;
    if (!person) {
      let firstName: string;
      let lastName: string;
      let email: string;
      do {
        firstName = faker.person.firstName(sex);
        lastName = faker.person.lastName();
        email = `dr.${lastName.toLowerCase().replace(/[^a-z]/g, '')}@medassist.dev`;
      } while (emails.has(email));
      emails.add(email);
      person = { firstName, lastName, email };
    }
    let registrationNumber: string;
    do {
      registrationNumber = `KMC-${faker.number.int({ min: 20_000, max: 99_999 })}`;
    } while (registrations.has(registrationNumber));
    registrations.add(registrationNumber);
    const experienceYears = faker.number.int({ min: 5, max: 25 });

    return {
      ...plan,
      ...person,
      phone: `+9198${faker.string.numeric(8)}`,
      registrationNumber,
      experienceYears,
      bio: `Dr ${person.firstName} ${person.lastName} is a ${plan.specialization.toLowerCase()} with ${experienceYears} years of experience in ${focus}.`,
    };
  });
}
