import type { Encounter } from '../src/features/encounters/api';
import type { Patient } from '../src/features/patients/api';
import type { Prescription } from '../src/features/prescriptions/api';
import { at, TODAY } from './appointments.fixtures';
import { receptionView } from './patients.fixtures';

/** The doctor's view of patient p1: allergies and chronic conditions, no insurance/admin notes. */
export const doctorView = (over: Partial<Patient> = {}): Patient => {
  const { insurance: _i, adminNotes: _a, portal: _p, ...rest } = receptionView();
  return {
    ...rest,
    chronicConditions: [
      {
        id: 'c1',
        name: 'Hypertension',
        since: '2020-01-01',
        notes: null,
        recordedBy: 'dr1',
        recordedAt: null,
      },
    ],
    ...over,
  };
};

/** A draft note of appointment a1 (doctor dr1, patient p1). */
export function encounter(over: Partial<Encounter> = {}): Encounter {
  return {
    id: 'e1',
    encounterNumber: 'ENC-2026-000007',
    appointmentId: 'a1',
    patient: { id: 'p1', mrn: 'MRN-000001', fullName: 'Priya Sharma' },
    doctor: { id: 'dr1', name: 'Anil Mehta' },
    visitAt: at(TODAY, '09:30'),
    status: 'draft',
    version: 1,
    signedAt: null,
    lastAmendedAt: null,
    revision: 0,
    vitals: {
      bpSystolic: null,
      bpDiastolic: null,
      pulse: null,
      temperatureC: null,
      respiratoryRate: null,
      spo2: null,
      weightKg: null,
      heightCm: null,
      bmi: null,
      recordedAt: null,
      recordedBy: null,
    },
    chiefComplaint: null,
    historyOfPresentIllness: null,
    pastHistory: null,
    examination: null,
    diagnoses: [],
    assessment: null,
    plan: null,
    adviceToPatient: null,
    followUp: { required: false, afterDays: null, date: null, instructions: null },
    signedBy: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

/** A note ready to sign. */
export const signableNote = (over: Partial<Encounter> = {}) =>
  encounter({
    chiefComplaint: 'Fever for 3 days',
    diagnoses: [
      { description: 'Viral fever', icd10Code: 'B34.9', type: 'provisional', isPrimary: true },
    ],
    vitals: { ...encounter().vitals, temperatureC: 38.4, pulse: 96 },
    ...over,
  });

export function prescription(over: Partial<Prescription> = {}): Prescription {
  return {
    id: 'rx1',
    prescriptionNumber: null,
    status: 'draft',
    encounterId: 'e1',
    appointmentId: 'a1',
    doctor: { id: 'dr1', name: 'Anil Mehta' },
    issuedAt: null,
    completedAt: null,
    generalInstructions: null,
    patient: { id: 'p1', mrn: 'MRN-000001', fullName: 'Priya Sharma', age: 36, gender: 'female' },
    isCurrent: true,
    revision: 0,
    items: [
      {
        drugName: 'Paracetamol',
        genericName: 'Paracetamol',
        strength: '650 mg',
        form: 'tablet',
        dose: '1 tablet',
        route: 'oral',
        frequency: 'TDS',
        frequencyText: null,
        frequencyLabel: 'Three times a day',
        timing: 'after_food',
        durationDays: 3,
        quantity: null,
        instructions: null,
        allergyWarning: null,
      },
    ],
    allergyWarnings: [],
    allergyCheckNotice:
      'Allergy check is a convenience name match against recorded allergies – not clinical decision support.',
    cancellation: null,
    replaces: null,
    ...over,
  };
}

export const listOf = <T>(items: T[]) => ({
  items,
  meta: { page: 1, limit: 20, total: items.length, totalPages: 1 },
});
