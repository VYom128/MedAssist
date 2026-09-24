import type { Types } from 'mongoose';
import {
  ALLERGY_CHECK_NOTICE,
  DRUG_FREQUENCIES,
  type DrugFrequency,
} from '../../config/constants.js';
import { ageOf } from '../patients/serializer.js';
import type { PrescriptionDoc, PrescriptionItem } from './model.js';

/**
 * Prescription views (spec §2.4, §7.12):
 * - doctor: everything, including allergy warnings with who acknowledged them;
 * - patient (own, issued/completed): the prescription as printed – no internal warnings;
 * - receptionist (print only, issued/completed): the printed prescription with the patient's
 *   name, MRN, age and sex – no allergy warning details.
 */

interface UserRef {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
}
interface PatientRef {
  _id: Types.ObjectId;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
}

export type PrescriptionLike = Omit<PrescriptionDoc, 'doctor' | 'patient'> & {
  _id: Types.ObjectId;
  __v?: number;
  doctor: UserRef;
  patient: PatientRef;
  createdAt?: Date;
  updatedAt?: Date;
};

export const PRESCRIPTION_POPULATE = [
  { path: 'doctor', select: 'firstName lastName' },
  { path: 'patient', select: 'mrn firstName lastName dateOfBirth gender' },
] as const;

const idOf = (id?: Types.ObjectId | null) => id?.toString() ?? null;
const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

/** An item as printed: drug, dose, how often (with the label), for how long. */
function printedItem(i: PrescriptionItem) {
  const frequency = (i.frequency ?? null) as DrugFrequency | null;
  return {
    drugName: i.drugName,
    genericName: orNull(i.genericName),
    strength: orNull(i.strength),
    form: orNull(i.form),
    dose: orNull(i.dose),
    route: orNull(i.route),
    frequency,
    frequencyText: orNull(i.frequencyText),
    frequencyLabel:
      frequency === 'other'
        ? orNull(i.frequencyText)
        : frequency
          ? DRUG_FREQUENCIES[frequency]
          : null,
    timing: orNull(i.timing),
    durationDays: orNull(i.durationDays),
    quantity: orNull(i.quantity),
    instructions: orNull(i.instructions),
  };
}

function core(p: PrescriptionLike) {
  return {
    id: p._id.toString(),
    prescriptionNumber: orNull(p.prescriptionNumber),
    status: p.status,
    encounterId: p.encounter.toString(),
    appointmentId: p.appointment.toString(),
    doctor: { id: p.doctor._id.toString(), name: `${p.doctor.firstName} ${p.doctor.lastName}` },
    issuedAt: orNull(p.issuedAt),
    completedAt: orNull(p.completedAt),
    generalInstructions: orNull(p.generalInstructions),
  };
}

const patientBlock = (p: PrescriptionLike) => ({
  id: p.patient._id.toString(),
  mrn: p.patient.mrn,
  fullName: `${p.patient.firstName} ${p.patient.lastName}`,
  age: ageOf(p.patient),
  gender: p.patient.gender,
});

/** Per-item allergy warnings for the doctor (index = item position). */
export function allergyWarningsOf(p: Pick<PrescriptionLike, 'items'>) {
  return (p.items ?? []).flatMap((i, index) =>
    i.allergyWarning
      ? [
          {
            itemIndex: index,
            drugName: i.drugName,
            substance: i.allergyWarning.substance,
            matchedOn: i.allergyWarning.matchedOn,
            drugClass: orNull(i.allergyWarning.drugClass),
            acknowledged: Boolean(i.allergyWarning.acknowledgedAt),
          },
        ]
      : [],
  );
}

/** The full prescription for a doctor. */
export function toDoctorView(p: PrescriptionLike) {
  return {
    ...core(p),
    patient: patientBlock(p),
    isCurrent: p.isCurrent,
    /** Send back as `expectedVersion` when saving the draft. */
    revision: p.__v ?? 0,
    items: (p.items ?? []).map((i) => ({
      ...printedItem(i),
      allergyWarning: i.allergyWarning
        ? {
            substance: i.allergyWarning.substance,
            matchedOn: i.allergyWarning.matchedOn,
            drugClass: orNull(i.allergyWarning.drugClass),
            acknowledged: Boolean(i.allergyWarning.acknowledgedAt),
            acknowledgedBy: idOf(i.allergyWarning.acknowledgedBy),
            acknowledgedAt: orNull(i.allergyWarning.acknowledgedAt),
          }
        : null,
    })),
    allergyWarnings: allergyWarningsOf(p),
    allergyCheckNotice: ALLERGY_CHECK_NOTICE,
    cancellation: p.cancellation?.at
      ? {
          by: idOf(p.cancellation.by),
          at: p.cancellation.at,
          reason: orNull(p.cancellation.reason),
        }
      : null,
    replaces: idOf(p.replaces),
    createdAt: orNull(p.createdAt),
    updatedAt: orNull(p.updatedAt),
  };
}

/** The patient's own issued prescription: as printed, no internal warnings. */
export function toPatientView(p: PrescriptionLike) {
  return { ...core(p), items: (p.items ?? []).map(printedItem) };
}

/** Reception, for printing: the printed prescription with the patient's identifiers. */
export function toPrintView(p: PrescriptionLike) {
  return { ...core(p), patient: patientBlock(p), items: (p.items ?? []).map(printedItem) };
}

/** One row of GET /prescriptions. */
export function toListItem(p: PrescriptionLike, { withPatient }: { withPatient: boolean }) {
  return {
    id: p._id.toString(),
    prescriptionNumber: orNull(p.prescriptionNumber),
    status: p.status,
    doctor: { id: p.doctor._id.toString(), name: `${p.doctor.firstName} ${p.doctor.lastName}` },
    ...(withPatient
      ? {
          patient: {
            id: p.patient._id.toString(),
            mrn: p.patient.mrn,
            fullName: `${p.patient.firstName} ${p.patient.lastName}`,
          },
        }
      : {}),
    encounterId: p.encounter.toString(),
    appointmentId: p.appointment.toString(),
    itemCount: (p.items ?? []).length,
    issuedAt: orNull(p.issuedAt),
    createdAt: orNull(p.createdAt),
  };
}
