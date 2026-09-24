import { createHash } from 'node:crypto';
import { faker } from '@faker-js/faker';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { ROLES } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import { amendEncounter } from '../modules/encounters/amendment.service.js';
import { ensureEncounterDraft } from '../modules/encounters/draft.js';
import { Encounter } from '../modules/encounters/model.js';
import { insertSignedNoteForSeed } from '../modules/encounters/seed.service.js';
import { updateEncounter } from '../modules/encounters/service.js';
import { amendEncounterSchema, encounterFields } from '../modules/encounters/validation.js';
import { Department } from '../modules/departments/model.js';
import { Patient } from '../modules/patients/model.js';
import { buildItems } from '../modules/prescriptions/service.js';
import { putPrescriptionSchema } from '../modules/prescriptions/validation.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import { checkAllergies } from '../services/allergyCheck.js';
import type { AuthUser } from '../types/express.js';
import { ageOn, clinicToday } from '../utils/dates.js';
import { withTransaction } from '../utils/transaction.js';
import { SEED_REQUEST } from './context.js';
import {
  AMENDMENT_REASONS,
  ENCOUNTER_TEMPLATES,
  FOLLOW_UP_TEMPLATES,
  TEMPLATES_BY_REASON,
  TODAY_DRAFT,
  type EncounterTemplate,
  type TemplateItem,
} from './data/encounterTemplates.js';

/**
 * Clinical notes and prescriptions (spec §15.3), after the appointments seeder:
 * - a SIGNED note for every completed appointment, from ~20 templates matched to the stated
 *   reason (vitals varied per visit), through the seed-only `insertSignedNoteForSeed` (no 72 h
 *   window); prescriptions issued for most (~85 %), follow-up plans on ~40 %;
 * - never a drug the patient is allergic to (the template's alternative instead), except one
 *   demo: a patient allergic to ibuprofen prescribed a topical diclofenac gel with the allergy
 *   warning acknowledged;
 * - three signed notes amended with a reason (through the amendment service);
 * - the consultations under way today get a partly written draft (through the autosave service).
 * Idempotent: every choice is derived from the appointment number, notes are created only for
 * appointments without one, and amendments only once. `--reset` clears notes, amendments and
 * prescriptions.
 */

const NOTE_SCHEMA = z.strictObject(encounterFields);
const ITEMS_SCHEMA = putPrescriptionSchema.body.shape.items;
const PRESCRIPTION_SHARE = 0.96; // of notes whose template has drugs → ~85 % of all notes
const FOLLOW_UP_SHARE = 0.6; // of templates with a follow-up → ~40 % of all notes
/** Positions (in encounter-number order) of the notes to amend. */
const AMEND_AT = [4, 24, 44];

/** A number from the appointment number, so each visit gets the same choices on every run. */
function seedFor(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0);
}

const float = (range: [number, number], digits = 0) =>
  faker.number.float({ min: range[0], max: range[1], fractionDigits: digits });

/** Weight and height for an age (years). */
function bodySize(age: number) {
  if (age < 5) return { weightKg: float([11, 18], 1), heightCm: float([85, 110]) };
  if (age < 12) return { weightKg: float([18, 38], 1), heightCm: float([110, 148]) };
  if (age < 18) return { weightKg: float([38, 60], 1), heightCm: float([145, 175]) };
  return { weightKg: float([48, 92], 1), heightCm: float([150, 182]) };
}

function vitalsFor(t: EncounterTemplate, age: number) {
  const v = t.vitals;
  return {
    temperatureC: float(v.temperatureC, 1),
    pulse: float(v.pulse),
    bpSystolic: float(v.bpSystolic),
    bpDiastolic: float(v.bpDiastolic),
    respiratoryRate: float(v.respiratoryRate),
    spo2: float(v.spo2),
    ...bodySize(age),
  };
}

const withoutAlternative = ({ alternative: _alt, ...item }: TemplateItem) => item;

interface PatientInfo {
  dateOfBirth: Date;
  allergies: { substance: string }[];
}

/**
 * The template's items for this patient: a drug matching one of their allergies is replaced by
 * its alternative (or left out). `demoAck` keeps a matching topical drug and acknowledges it.
 */
function itemsFor(t: EncounterTemplate, patient: PatientInfo, demoAck: boolean) {
  let acknowledged = false;
  const chosen = t.items.flatMap((item) => {
    const [match] = checkAllergies([item], patient.allergies);
    if (!match) return [withoutAlternative(item)];
    if (demoAck && !acknowledged && item.route === 'topical') {
      acknowledged = true;
      return [{ ...withoutAlternative(item), acknowledgeAllergy: true }];
    }
    const alt = item.alternative;
    if (alt && !checkAllergies([alt], patient.allergies)[0]) return [alt];
    return [];
  });
  return { items: chosen, acknowledged };
}

function templateFor(reason: string | null | undefined, dept: string, seed: number) {
  const keys = (reason && TEMPLATES_BY_REASON[reason]) || FOLLOW_UP_TEMPLATES[dept] || ['urti'];
  return ENCOUNTER_TEMPLATES[keys[seed % keys.length]!]!;
}

/** A doctor as the acting user for services (autosave, amendments). */
async function doctorActor(doctorId: Types.ObjectId): Promise<AuthUser> {
  const u = await User.findById(doctorId).lean();
  if (!u) throw new Error(`Seed doctor ${doctorId.toString()} is missing`);
  return {
    id: u._id.toString(),
    role: ROLES.DOCTOR,
    sessionId: 'seed',
    sessionFamily: 'seed',
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    mustChangePassword: false,
    patientId: null,
  };
}

export async function seedEncounters(): Promise<Record<string, number>> {
  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const result = {
    created: 0,
    unchanged: 0,
    prescriptions: 0,
    followUps: 0,
    allergySubstitutions: 0,
    acknowledgedWarnings: 0,
    amended: 0,
    todayDrafts: 0,
  };

  const departments = new Map(
    (await Department.find().select('code').lean()).map((d) => [d._id.toString(), d.code]),
  );
  const completed = await Appointment.find({ status: 'completed' })
    .select('appointmentNumber patient doctor department startAt reason queue.completedAt')
    .sort({ startAt: 1 })
    .lean();
  const existing = new Set(
    (await Encounter.find().select('appointment').lean()).map((e) => e.appointment.toString()),
  );
  const patients = new Map(
    (
      await Patient.find({ _id: { $in: completed.map((a) => a.patient) } })
        .select('dateOfBirth allergies.substance')
        .lean()
    ).map((p) => [p._id.toString(), p as PatientInfo]),
  );
  // The acknowledged-warning demo: the first completed visit of a patient allergic to
  // ibuprofen (an NSAID) gets the knee-pain note with a topical diclofenac gel.
  const demoVisit = completed.find((a) =>
    patients
      .get(a.patient.toString())
      ?.allergies.some((al) => al.substance.toLowerCase() === 'ibuprofen'),
  );
  const actors = new Map<string, AuthUser>();
  const actorFor = async (id: Types.ObjectId) => {
    const key = id.toString();
    if (!actors.has(key)) actors.set(key, await doctorActor(id));
    return actors.get(key)!;
  };

  for (const appt of completed) {
    if (existing.has(appt._id.toString())) {
      result.unchanged += 1;
      continue;
    }
    const seed = seedFor(appt.appointmentNumber);
    faker.seed(seed);
    const patient = patients.get(appt.patient.toString());
    if (!patient) continue;
    const isDemo = demoVisit?._id.equals(appt._id) ?? false;
    const dept = departments.get(appt.department?.toString() ?? '') ?? 'GEN';
    const t = isDemo ? ENCOUNTER_TEMPLATES.knee_pain! : templateFor(appt.reason, dept, seed);
    const age = ageOn(patient.dateOfBirth, today);
    const withFollowUp = Boolean(t.followUp) && faker.number.float() < FOLLOW_UP_SHARE;
    const note = NOTE_SCHEMA.parse({
      chiefComplaint: t.chiefComplaint,
      historyOfPresentIllness: t.historyOfPresentIllness,
      ...(t.pastHistory ? { pastHistory: t.pastHistory } : {}),
      examination: t.examination,
      vitals: vitalsFor(t, age),
      diagnoses: t.diagnoses.map((d, i) => ({ ...d, isPrimary: i === 0 })),
      assessment: t.assessment,
      plan: t.plan,
      adviceToPatient: t.adviceToPatient,
      followUp: withFollowUp
        ? {
            required: true,
            afterDays: t.followUp!.afterDays,
            instructions: t.followUp!.instructions,
          }
        : { required: false },
    });

    const doctor = await actorFor(appt.doctor);
    const signedAt = appt.queue?.completedAt ?? new Date(appt.startAt.getTime() + 15 * 60_000);
    let prescription: { items: Record<string, unknown>[] } | null = null;
    if (t.items.length > 0 && (isDemo || faker.number.float() < PRESCRIPTION_SHARE)) {
      const { items, acknowledged } = itemsFor(t, patient, isDemo);
      if (
        items.length !== t.items.length ||
        items.some((i, n) => i.drugName !== t.items[n]?.drugName)
      ) {
        result.allergySubstitutions += 1;
      }
      if (items.length > 0) {
        const parsed = ITEMS_SCHEMA.parse(items);
        prescription = { items: buildItems(parsed, [], patient.allergies, doctor.id, signedAt) };
        if (acknowledged) result.acknowledgedWarnings += 1;
      }
    }

    const { vitals, ...fields } = note;
    const created = await insertSignedNoteForSeed({
      appointment: appt,
      doctor,
      signedAt,
      note: {
        ...Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== null && v !== undefined),
        ),
        vitals: vitals ?? undefined,
      },
      prescription,
      request: SEED_REQUEST,
    });
    result.created += 1;
    if (created.prescriptionId) result.prescriptions += 1;
    if (withFollowUp) result.followUps += 1;
  }

  // Three amended notes (through the amendment service, with a reason).
  const signed = await Encounter.find({ status: { $in: ['signed', 'amended'] } })
    .select('encounterNumber status doctor vitals examination followUp')
    .sort({ encounterNumber: 1 })
    .lean();
  for (const [n, index] of AMEND_AT.entries()) {
    const e = signed[index];
    if (!e) continue;
    if (e.status === 'amended') {
      result.amended += 1;
      continue;
    }
    const changes = [
      { vitals: { bpSystolic: 128, bpDiastolic: 82 } },
      { examination: `${e.examination ?? ''} Mild pallor noted.`.trim() },
      { followUp: { required: true, afterDays: 14, instructions: 'Review in two weeks' } },
    ][n]!;
    const input = amendEncounterSchema.body.parse({ reason: AMENDMENT_REASONS[n], changes });
    await amendEncounter(await actorFor(e.doctor), e._id.toString(), input, SEED_REQUEST);
    result.amended += 1;
  }

  // Today's consultations under way: a partly written draft note.
  const underWay = await Appointment.find({ status: 'in_consultation' })
    .select('patient doctor startAt')
    .lean();
  for (const appt of underWay) {
    if (await Encounter.exists({ appointment: appt._id })) continue;
    const doctor = await actorFor(appt.doctor);
    const draft = await withTransaction((session) =>
      ensureEncounterDraft(appt, {
        by: doctor.id,
        year: Number(today.slice(0, 4)),
        session,
      }),
    );
    await updateEncounter(
      doctor,
      draft.id.toString(),
      { expectedVersion: 0, ...NOTE_SCHEMA.parse(TODAY_DRAFT) },
      SEED_REQUEST,
    );
    result.todayDrafts += 1;
  }
  return result;
}
