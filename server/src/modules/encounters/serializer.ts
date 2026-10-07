import type { Types } from 'mongoose';
import { calendarDateString } from '../../utils/dates.js';
import type { EncounterDoc } from './model.js';

/**
 * Encounter views (spec §2.4, §7.10). Doctors read the full note; patients read their own signed
 * notes through the patient-safe view (Phase 8). List items carry no clinical text, so lists
 * need no per-row read audit; the full note is audited as `encounter.view`.
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
}

/** An encounter with `doctor` and `patient` populated. */
export type EncounterLike = Omit<EncounterDoc, 'doctor' | 'patient'> & {
  _id: Types.ObjectId;
  __v?: number;
  doctor: UserRef;
  patient: PatientRef;
  createdAt?: Date;
  updatedAt?: Date;
};

/** What `populate()` loads for the views. */
export const ENCOUNTER_POPULATE = [
  { path: 'doctor', select: 'firstName lastName' },
  { path: 'patient', select: 'mrn firstName lastName' },
] as const;

const idOf = (id?: Types.ObjectId | null) => id?.toString() ?? null;
const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

function base(e: EncounterLike) {
  return {
    id: e._id.toString(),
    encounterNumber: e.encounterNumber,
    appointmentId: e.appointment.toString(),
    patient: {
      id: e.patient._id.toString(),
      mrn: e.patient.mrn,
      fullName: `${e.patient.firstName} ${e.patient.lastName}`,
    },
    doctor: { id: e.doctor._id.toString(), name: `${e.doctor.firstName} ${e.doctor.lastName}` },
    visitAt: e.visitAt,
    status: e.status,
    /** Note version: 1 when signed, +1 per amendment (spec §5.2). */
    version: e.version,
    signedAt: orNull(e.signedAt),
    lastAmendedAt: orNull(e.lastAmendedAt),
  };
}

/**
 * One row of GET /encounters: no clinical text – except, for one patient's history
 * (`withDiagnosis`, audited by the service), the primary diagnosis.
 */
export function toListItem(e: EncounterLike, { withDiagnosis = false } = {}) {
  const primary = (e.diagnoses ?? []).find((d) => d.isPrimary) ?? e.diagnoses?.[0];
  return {
    ...base(e),
    ...(withDiagnosis ? { primaryDiagnosis: primary?.description ?? null } : {}),
    updatedAt: orNull(e.updatedAt),
  };
}

/** The full note for a doctor (own, or signed notes of a related patient). */
export function toDoctorView(e: EncounterLike) {
  const v = e.vitals ?? {};
  return {
    ...base(e),
    /** Send back as `expectedVersion` when saving (optimistic concurrency). */
    revision: e.__v ?? 0,
    vitals: {
      bpSystolic: orNull(v.bpSystolic),
      bpDiastolic: orNull(v.bpDiastolic),
      pulse: orNull(v.pulse),
      temperatureC: orNull(v.temperatureC),
      respiratoryRate: orNull(v.respiratoryRate),
      spo2: orNull(v.spo2),
      weightKg: orNull(v.weightKg),
      heightCm: orNull(v.heightCm),
      bmi: orNull(v.bmi),
      recordedAt: orNull(v.recordedAt),
      recordedBy: idOf(v.recordedBy),
    },
    chiefComplaint: orNull(e.chiefComplaint),
    historyOfPresentIllness: orNull(e.historyOfPresentIllness),
    pastHistory: orNull(e.pastHistory),
    examination: orNull(e.examination),
    diagnoses: (e.diagnoses ?? []).map((d) => ({
      description: d.description,
      icd10Code: orNull(d.icd10Code),
      type: d.type ?? 'provisional',
      isPrimary: d.isPrimary ?? false,
    })),
    assessment: orNull(e.assessment),
    plan: orNull(e.plan),
    adviceToPatient: orNull(e.adviceToPatient),
    followUp: {
      required: e.followUp?.required ?? false,
      afterDays: orNull(e.followUp?.afterDays),
      date: e.followUp?.date ? calendarDateString(e.followUp.date) : null,
      instructions: orNull(e.followUp?.instructions),
    },
    shareDiagnosisWithPatient: e.shareDiagnosisWithPatient ?? false,
    signedBy: idOf(e.signedBy),
    createdAt: orNull(e.createdAt),
    updatedAt: orNull(e.updatedAt),
  };
}

// ---- Patient-safe view (Phase 8) -------------------------------------------------------------

/** What the patient-safe view links to and shows besides the note itself. */
export interface PatientViewExtras {
  department: { id: string; name: string } | null;
  /** The visit's issued (or completed) prescription. */
  prescriptionId: string | null;
  /** The visit's released lab orders. */
  labOrders: { id: string; orderNumber: string | null }[];
}

const sharedDiagnoses = (e: Pick<EncounterLike, 'diagnoses' | 'shareDiagnosisWithPatient'>) =>
  e.shareDiagnosisWithPatient
    ? (e.diagnoses ?? []).map((d) => ({
        description: d.description,
        icd10Code: orNull(d.icd10Code),
        type: d.type ?? 'provisional',
        isPrimary: d.isPrimary ?? false,
      }))
    : null;

/** The primary (else the first) diagnosis, if the doctor shared the diagnoses. */
export function sharedPrimaryDiagnosis(e: {
  diagnoses?: readonly { description: string; isPrimary?: boolean | null }[] | null;
  shareDiagnosisWithPatient?: boolean | null;
}): string | null {
  if (!e.shareDiagnosisWithPatient) return null;
  const primary = (e.diagnoses ?? []).find((d) => d.isPrimary) ?? e.diagnoses?.[0];
  return primary?.description ?? null;
}

/**
 * A signed note as the patient sees it (Phase 8 decision): the visit, doctor and department,
 * vitals, advice and the follow-up plan, with links to the prescription and released lab
 * orders. Diagnoses only when the doctor shared them. Never the history, examination,
 * assessment, plan, chief complaint or who recorded what.
 */
export function toPatientSafeView(e: EncounterLike, extras: PatientViewExtras) {
  const v = e.vitals ?? {};
  return {
    id: e._id.toString(),
    encounterNumber: e.encounterNumber,
    appointmentId: e.appointment.toString(),
    visitAt: e.visitAt,
    signedAt: orNull(e.signedAt),
    status: e.status,
    /** Corrected after signing (an amendment). */
    amended: e.status === 'amended',
    doctor: { id: e.doctor._id.toString(), name: `${e.doctor.firstName} ${e.doctor.lastName}` },
    department: extras.department,
    vitals: {
      bpSystolic: orNull(v.bpSystolic),
      bpDiastolic: orNull(v.bpDiastolic),
      pulse: orNull(v.pulse),
      temperatureC: orNull(v.temperatureC),
      respiratoryRate: orNull(v.respiratoryRate),
      spo2: orNull(v.spo2),
      weightKg: orNull(v.weightKg),
      heightCm: orNull(v.heightCm),
      bmi: orNull(v.bmi),
    },
    diagnosisShared: Boolean(e.shareDiagnosisWithPatient),
    diagnoses: sharedDiagnoses(e),
    adviceToPatient: orNull(e.adviceToPatient),
    followUp: {
      required: e.followUp?.required ?? false,
      afterDays: orNull(e.followUp?.afterDays),
      date: e.followUp?.date ? calendarDateString(e.followUp.date) : null,
      instructions: orNull(e.followUp?.instructions),
    },
    prescriptionId: extras.prescriptionId,
    labOrders: extras.labOrders,
  };
}

/** One row of GET /patients/me/visits: no clinical text except a shared primary diagnosis. */
export function toPatientVisitItem(
  e: EncounterLike,
  department: { id: string; name: string } | null,
) {
  return {
    id: e._id.toString(),
    encounterNumber: e.encounterNumber,
    visitAt: e.visitAt,
    signedAt: orNull(e.signedAt),
    status: e.status,
    doctor: { id: e.doctor._id.toString(), name: `${e.doctor.firstName} ${e.doctor.lastName}` },
    department,
    primaryDiagnosis: sharedPrimaryDiagnosis(e),
  };
}
