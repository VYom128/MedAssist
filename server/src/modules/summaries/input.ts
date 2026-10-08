import type { Types } from 'mongoose';
import { hashInput } from '../../ai/ai.service.js';
import { createScrubber, demographics, nameVariants } from '../../ai/deidentify.js';
import type { SummaryInput } from '../../ai/prompts/clinicalSummary.v1.js';
import { clinicToday } from '../../utils/dates.js';
import type { EncounterLike } from '../encounters/serializer.js';
import { LabOrder } from '../labOrders/model.js';
import { Patient } from '../patients/model.js';
import { Prescription } from '../prescriptions/model.js';
import { getSettings } from '../settings/service.js';

/**
 * The de-identified input of a clinical summary (spec §9.2 input, §9.1 de-identification),
 * built from structured data only: age and sex, allergies, chronic conditions, vitals, the note's
 * clinical fields, diagnoses, the current prescription, the note's lab tests (results only once
 * released) and the follow-up plan. Free text goes through the scrubber (names of the patient,
 * the doctor and the emergency contact → [name]; phones, emails, record numbers removed).
 * Never sent: names, MRN, phone, email, address, date of birth, ids, dates.
 *
 * `inputHash` identifies the content: a summary whose hash no longer matches is outdated. It
 * holds nothing that signing changes by itself (no statuses besides "results released"; draft
 * lab orders count like placed ones), so a summary of a finished draft survives the signing.
 */

const VITAL_KEYS = [
  'bpSystolic',
  'bpDiastolic',
  'pulse',
  'temperatureC',
  'respiratoryRate',
  'spo2',
  'weightKg',
  'heightCm',
  'bmi',
] as const;

interface PatientFields {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date | null;
  gender?: string | null;
  allergies?: { substance: string; reaction?: string | null; severity: string }[];
  chronicConditions?: { name: string }[];
  emergencyContact?: { name?: string | null } | null;
}

const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

function resultValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export async function buildSummaryInput(
  e: EncounterLike,
): Promise<{ input: SummaryInput; inputHash: string }> {
  const [patient, prescription, labOrders, { timezone }] = await Promise.all([
    Patient.findById(e.patient._id)
      .select(
        'firstName lastName dateOfBirth gender allergies chronicConditions emergencyContact.name',
      )
      .lean<PatientFields>(),
    Prescription.findOne({ encounter: e._id, isCurrent: true })
      .select('status items generalInstructions')
      .lean(),
    LabOrder.find({ encounter: e._id, status: { $ne: 'cancelled' } })
      .select('status items.testSnapshot.name items.status items.results')
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    getSettings(),
  ]);

  const scrub = createScrubber(
    nameVariants([patient ?? e.patient, e.doctor, patient?.emergencyContact?.name ?? null]),
  );

  const vitals: Record<string, number> = {};
  for (const key of VITAL_KEYS) {
    const v = (e.vitals as Record<string, unknown> | undefined)?.[key];
    if (typeof v === 'number') vitals[key] = v;
  }

  const input: SummaryInput = {
    patient: {
      ...demographics(patient ?? {}, clinicToday(timezone)),
      allergies: (patient?.allergies ?? []).map((a) => ({
        substance: scrub(a.substance) ?? '',
        reaction: scrub(a.reaction),
        severity: a.severity,
      })),
      chronicConditions: (patient?.chronicConditions ?? [])
        .map((c) => scrub(c.name))
        .filter((c): c is string => Boolean(c)),
    },
    vitals,
    chiefComplaint: scrub(e.chiefComplaint),
    historyOfPresentIllness: scrub(e.historyOfPresentIllness),
    pastHistory: scrub(e.pastHistory),
    examination: scrub(e.examination),
    diagnoses: (e.diagnoses ?? []).map((d) => ({
      description: scrub(d.description) ?? '',
      type: d.type ?? 'provisional',
      isPrimary: Boolean(d.isPrimary),
      icd10Code: orNull(d.icd10Code),
    })),
    assessment: scrub(e.assessment),
    plan: scrub(e.plan),
    adviceToPatient: scrub(e.adviceToPatient),
    prescription: prescription
      ? {
          items: (prescription.items ?? []).map((i) => ({
            drugName: scrub(i.drugName) ?? '',
            genericName: scrub(i.genericName),
            strength: orNull(i.strength),
            form: orNull(i.form),
            dose: scrub(i.dose),
            route: orNull(i.route),
            frequency: i.frequency === 'other' ? scrub(i.frequencyText) : orNull(i.frequency),
            timing: orNull(i.timing),
            durationDays: orNull(i.durationDays),
            instructions: scrub(i.instructions),
          })),
          generalInstructions: scrub(prescription.generalInstructions),
        }
      : null,
    labTests: labOrders.flatMap((o) =>
      (o.items ?? [])
        .filter((i) => i.status !== 'cancelled')
        .map((i) => ({
          name: i.testSnapshot.name,
          status: o.status === 'released' ? 'released' : 'pending',
          results:
            o.status === 'released'
              ? (i.results ?? []).map((r) => ({
                  name: r.name,
                  value: resultValue(r.value),
                  unit: orNull(r.unit),
                  flag: orNull(r.flag),
                }))
              : [],
        })),
    ),
    followUp: e.followUp?.required
      ? { afterDays: orNull(e.followUp.afterDays), instructions: scrub(e.followUp.instructions) }
      : null,
  };
  return { input, inputHash: hashInput(input) };
}
