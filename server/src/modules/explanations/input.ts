import type { Types } from 'mongoose';
import { createScrubber, nameVariants, type Scrubber } from '../../ai/deidentify.js';
import type {
  ExplanationInput,
  ExplanationMedicine,
} from '../../ai/prompts/patientExplanation.v1.js';
import { AI_RULES, type ExplanationLanguage } from '../../config/constants.js';
import { followUpDueDate } from '../encounters/followUp.js';
import type { EncounterLike } from '../encounters/serializer.js';
import { Patient } from '../patients/model.js';
import type { PrescriptionLike } from '../prescriptions/serializer.js';
import { getSettings } from '../settings/service.js';

/**
 * The de-identified input of a patient explanation (spec §9.3 input, §9.1): only what the
 * patient may read anyway – the issued prescription's items and general instructions, or the
 * signed note's follow-up plan (the patient-safe fields, never the clinical note). The doctor's
 * free text goes through the scrubber (names → [name]; phones, emails, record numbers removed).
 */

interface PersonRef {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

async function scrubberFor(patientId: Types.ObjectId, doctor: PersonRef): Promise<Scrubber> {
  const patient = await Patient.findById(patientId)
    .select('firstName lastName emergencyContact.name')
    .lean();
  return createScrubber(nameVariants([patient, doctor, patient?.emergencyContact?.name ?? null]));
}

const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

export async function buildPrescriptionInput(
  rx: PrescriptionLike,
  language: ExplanationLanguage,
): Promise<ExplanationInput> {
  const scrub = await scrubberFor(rx.patient._id, rx.doctor);
  const medicines: ExplanationMedicine[] = (rx.items ?? []).map((i) => ({
    name: scrub(i.drugName) ?? '',
    genericName: scrub(i.genericName),
    strength: orNull(i.strength),
    form: orNull(i.form),
    dose: scrub(i.dose),
    route: orNull(i.route),
    frequency: orNull(i.frequency),
    frequencyText: scrub(i.frequencyText),
    timing: orNull(i.timing),
    durationDays: orNull(i.durationDays),
    instructions: scrub(i.instructions),
  }));
  return {
    language,
    readingAge: AI_RULES.explanationReadingAge,
    explains: 'prescription',
    medicines,
    generalInstructions: scrub(rx.generalInstructions),
    followUp: null,
  };
}

export async function buildFollowUpInput(
  e: EncounterLike,
  language: ExplanationLanguage,
): Promise<ExplanationInput> {
  const scrub = await scrubberFor(e.patient._id, e.doctor);
  const { timezone } = await getSettings();
  return {
    language,
    readingAge: AI_RULES.explanationReadingAge,
    explains: 'follow_up_plan',
    medicines: [],
    generalInstructions: null,
    followUp: {
      afterDays: orNull(e.followUp?.afterDays),
      date: followUpDueDate(
        { ...e, doctor: e.doctor._id } as Parameters<typeof followUpDueDate>[0],
        timezone,
      ),
      instructions: scrub(e.followUp?.instructions),
    },
  };
}
