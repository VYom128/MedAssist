import { fakerEN_IN as faker } from '@faker-js/faker';
import { addDaysToDate, subtractYears } from '../../utils/dates.js';
import { tryNormalisePhone } from '../../utils/phone.js';

/**
 * Patient demo data (spec §15.3): 60 patients with en_IN names, mixed ages (1–90), genders and
 * blood groups, Indian cities; 15 with allergies, 12 with chronic conditions, some insured.
 * A fixed faker seed and a fixed reference date make every run produce the same patients.
 */

export const PATIENT_FAKER_SEED = 20_260_924;
/** Dates of birth and insurance dates are computed from this day, not from "today". */
const REFERENCE_DATE = '2026-09-01';
export const PATIENT_COUNT = 60;
/** Patients 0–7 get portal logins patient1…patient8@medassist.dev. */
export const PORTAL_PATIENTS = 8;
/** Patient 8 has no login; the pending self-sign-up matches it (reception confirms it). */
export const PENDING_MATCH_INDEX = 8;
/** Patients 58 and 59: same name, different date of birth (duplicate-check demo). */
export const SIMILAR_PAIR = [58, 59] as const;

const CITIES = [
  { city: 'Bengaluru', state: 'Karnataka', pin: '5600' },
  { city: 'Mysuru', state: 'Karnataka', pin: '5700' },
  { city: 'Chennai', state: 'Tamil Nadu', pin: '6000' },
  { city: 'Hyderabad', state: 'Telangana', pin: '5000' },
  { city: 'Mumbai', state: 'Maharashtra', pin: '4000' },
  { city: 'Pune', state: 'Maharashtra', pin: '4110' },
  { city: 'New Delhi', state: 'Delhi', pin: '1100' },
  { city: 'Kolkata', state: 'West Bengal', pin: '7000' },
  { city: 'Kochi', state: 'Kerala', pin: '6820' },
  { city: 'Ahmedabad', state: 'Gujarat', pin: '3800' },
];

const ALLERGIES = [
  { substance: 'Penicillin', reaction: 'Skin rash and itching' },
  { substance: 'Sulfa drugs', reaction: 'Hives' },
  { substance: 'Peanuts', reaction: 'Swelling of lips and throat' },
  { substance: 'Dust mites', reaction: 'Sneezing and wheezing' },
  { substance: 'Ibuprofen', reaction: 'Stomach upset, rash' },
  { substance: 'Shellfish', reaction: 'Hives and vomiting' },
  { substance: 'Latex', reaction: 'Contact dermatitis' },
  { substance: 'Pollen', reaction: 'Seasonal rhinitis' },
];
const SEVERITIES = ['mild', 'moderate', 'severe'] as const;

const CONDITIONS = [
  { name: 'Type 2 diabetes', notes: 'On metformin; HbA1c reviewed every 3 months', adult: true },
  { name: 'Hypertension', notes: 'On amlodipine 5 mg', adult: true },
  { name: 'Asthma', notes: 'Salbutamol inhaler as needed', adult: false },
  { name: 'Hypothyroidism', notes: 'On levothyroxine', adult: true },
];

const INSURERS = ['Star Health', 'HDFC ERGO', 'ICICI Lombard', 'Niva Bupa', 'Care Health'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] as const;
const RELATIONS = ['Spouse', 'Mother', 'Father', 'Son', 'Daughter', 'Brother', 'Sister'];

/** Fixed names for the demo accounts that existed before Phase 3. */
const FIXED = [
  { firstName: 'Priya', lastName: 'Sharma', gender: 'female' as const, age: 34 },
  { firstName: 'Rahul', lastName: 'Verma', gender: 'male' as const, age: 41 },
];

export interface PatientSeed {
  /** POST /patients body (validated with createPatientSchema). */
  body: Record<string, unknown> & {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string;
  };
  /** Doctor-recorded conditions (written directly: no care relationships until Phase 5). */
  chronicConditions: { name: string; since: string; notes: string }[];
  /** patientN@medassist.dev for the portal patients. */
  portalEmail?: string;
}

function uniquePhone(used: Set<string>): string {
  for (;;) {
    const candidate = tryNormalisePhone(
      `+91${faker.helpers.arrayElement(['9', '8', '7', '6'])}${faker.string.numeric(9)}`,
    );
    if (candidate && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** The 60 demo patients (same result on every call). */
export function patientSeeds(): PatientSeed[] {
  faker.seed(PATIENT_FAKER_SEED);
  const phones = new Set<string>();
  const seeds: PatientSeed[] = [];

  for (let i = 0; i < PATIENT_COUNT; i++) {
    const fixed = FIXED[i];
    const gender = fixed?.gender ?? (i % 23 === 5 ? 'other' : i % 2 === 0 ? 'female' : 'male');
    const sex = gender === 'male' ? 'male' : 'female';
    let firstName = fixed?.firstName ?? faker.person.firstName(sex);
    let lastName = fixed?.lastName ?? faker.person.lastName();
    // Ages spread over 1–90: children, adults and older patients.
    let age = fixed?.age ?? 1 + ((i * 37) % 90);
    if (i === SIMILAR_PAIR[0] || i === SIMILAR_PAIR[1]) {
      firstName = 'Amit';
      lastName = 'Patel';
      age = i === SIMILAR_PAIR[0] ? 52 : 38;
    }
    const dateOfBirth = addDaysToDate(
      subtractYears(REFERENCE_DATE, age),
      -faker.number.int({ min: 0, max: 364 }),
    );
    const place = faker.helpers.arrayElement(CITIES);
    const portalEmail = i < PORTAL_PATIENTS ? `patient${i + 1}@medassist.dev` : undefined;
    const email =
      portalEmail ??
      (i % 10 < 7
        ? `${firstName}.${lastName}${i}@example.com`.toLowerCase().replace(/\s/g, '')
        : undefined);
    const adult = age >= 18;

    const body: PatientSeed['body'] = {
      firstName,
      lastName,
      dateOfBirth,
      gender,
      bloodGroup: faker.helpers.arrayElement(BLOOD_GROUPS),
      phone: uniquePhone(phones),
      ...(email ? { email } : {}),
      address: {
        line1: faker.location.streetAddress(),
        city: place.city,
        state: place.state,
        postalCode: `${place.pin}${faker.string.numeric(2)}`,
        country: 'India',
      },
      emergencyContact: {
        name: faker.person.fullName(),
        relation: adult ? faker.helpers.arrayElement(RELATIONS) : 'Mother',
        phone: uniquePhone(phones),
      },
      preferredLanguage: i % 4 === 3 ? 'hi' : 'en',
      consent: {
        dataProcessing: true,
        aiExplanations: i % 9 !== 4,
        communications: { email: true, sms: i % 3 === 0 },
      },
    };
    // 15 patients with allergies (every 4th, from the 2nd).
    if (i % 4 === 1) {
      const count = i % 8 === 1 ? 2 : 1;
      body.allergies = faker.helpers.arrayElements(ALLERGIES, count).map((a) => ({
        ...a,
        severity: faker.helpers.arrayElement(SEVERITIES),
      }));
    }
    // About a third insured.
    if (adult && i % 3 === 1) {
      body.insurance = {
        provider: faker.helpers.arrayElement(INSURERS),
        policyNumber: `POL-${faker.string.numeric(8)}`,
        validTill: addDaysToDate(REFERENCE_DATE, faker.number.int({ min: 60, max: 700 })),
      };
    }
    if (i % 11 === 6) body.adminNotes = 'Prefers morning appointments';

    // 12 patients with chronic conditions (every 5th, from the 3rd).
    const chronicConditions: PatientSeed['chronicConditions'] = [];
    if (i % 5 === 2) {
      const options = CONDITIONS.filter((c) => adult || !c.adult);
      const condition = faker.helpers.arrayElement(options);
      chronicConditions.push({
        name: condition.name,
        notes: condition.notes,
        since: subtractYears(REFERENCE_DATE, faker.number.int({ min: 1, max: Math.min(10, age) })),
      });
    }
    seeds.push({ body, chronicConditions, ...(portalEmail ? { portalEmail } : {}) });
  }
  return seeds;
}
