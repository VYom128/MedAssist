import { randomUUID } from 'node:crypto';
import mongoose, { Schema, type ClientSession, type InferSchemaType } from 'mongoose';
import {
  DIAGNOSIS_TYPES,
  ENCOUNTER_RULES,
  ENCOUNTER_STATUSES,
  ERROR_CODES,
} from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { computeBmi } from './vitals.js';

const { ObjectId } = Schema.Types;
const { vitals: RANGES, textLimits: LIMITS } = ENCOUNTER_RULES;

const vital = (key: keyof typeof RANGES) => ({
  type: Number,
  min: RANGES[key][0],
  max: RANGES[key][1],
});

const vitalsSchema = new Schema(
  {
    bpSystolic: vital('bpSystolic'),
    bpDiastolic: vital('bpDiastolic'),
    pulse: vital('pulse'),
    temperatureC: vital('temperatureC'),
    respiratoryRate: vital('respiratoryRate'),
    spo2: vital('spo2'),
    weightKg: vital('weightKg'),
    heightCm: vital('heightCm'),
    /** weight / (height m)², 1 decimal – computed by the server, never accepted as input. */
    bmi: Number,
    recordedAt: Date,
    recordedBy: { type: ObjectId, ref: 'User' },
  },
  { _id: false },
);

const diagnosisSchema = new Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: LIMITS.diagnosisDescription,
    },
    icd10Code: { type: String, trim: true, uppercase: true, maxlength: 10 },
    type: { type: String, enum: DIAGNOSIS_TYPES, default: 'provisional' },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const followUpSchema = new Schema(
  {
    required: { type: Boolean, default: false },
    afterDays: { type: Number, min: 1, max: ENCOUNTER_RULES.maxFollowUpDays },
    /** A clinic calendar date (UTC midnight, see `calendarDate`). */
    date: Date,
    instructions: { type: String, trim: true, maxlength: LIMITS.followUpInstructions },
  },
  { _id: false },
);

const text = (max: number) => ({ type: String, trim: true, maxlength: max });

/**
 * Encounter – the clinical note of one appointment (spec §6.13). `doctor` is the doctor's User
 * id. `visitAt` (not in §6.13) is the appointment's start, for lists and history. Drafts are
 * edited with optimistic concurrency on `__v` (the API's `revision`); `version` is the note
 * version that amendments increment (§5.2).
 *
 * Immutability (§10.5): once signed, the note changes only through the amendment service, which
 * passes the internal `amendmentWriteOptions()`. Every other update of a signed or amended
 * encounter – query, document or bulk – throws 409 RECORD_LOCKED; deletes always do.
 */
const encounterSchema = new Schema(
  {
    encounterNumber: { type: String, required: true, unique: true, immutable: true },
    appointment: {
      type: ObjectId,
      ref: 'Appointment',
      required: true,
      unique: true,
      immutable: true,
    },
    patient: { type: ObjectId, ref: 'Patient', required: true, index: true, immutable: true },
    doctor: { type: ObjectId, ref: 'User', required: true, index: true, immutable: true },
    visitAt: { type: Date, required: true, immutable: true },
    status: { type: String, enum: ENCOUNTER_STATUSES, default: 'draft', required: true },
    version: { type: Number, default: 1, min: 1 },
    vitals: { type: vitalsSchema, default: () => ({}) },
    chiefComplaint: text(LIMITS.chiefComplaint),
    historyOfPresentIllness: text(LIMITS.historyOfPresentIllness),
    pastHistory: text(LIMITS.pastHistory),
    examination: text(LIMITS.examination),
    diagnoses: {
      type: [diagnosisSchema],
      default: [],
      validate: [
        {
          validator: (d: unknown[]) => d.length <= ENCOUNTER_RULES.maxDiagnoses,
          message: `At most ${ENCOUNTER_RULES.maxDiagnoses} diagnoses`,
        },
        {
          validator: (d: { isPrimary?: boolean }[]) => d.filter((x) => x.isPrimary).length <= 1,
          message: 'At most one primary diagnosis',
        },
      ],
    },
    assessment: text(LIMITS.assessment),
    plan: text(LIMITS.plan),
    adviceToPatient: text(LIMITS.adviceToPatient),
    followUp: { type: followUpSchema, default: () => ({}) },
    signedAt: Date,
    signedBy: { type: ObjectId, ref: 'User' },
    lastAmendedAt: Date,
    createdBy: { type: ObjectId, ref: 'User' },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, optimisticConcurrency: true },
);

encounterSchema.index({ doctor: 1, status: 1, visitAt: -1 });
encounterSchema.index({ patient: 1, visitAt: -1 });

// ---- Immutability ---------------------------------------------------------------------------

/**
 * A random per-process token: only code holding `amendmentWriteOptions()` (the amendment
 * service) can update a signed note. It is a string, not a symbol, because Mongoose copies query
 * options.
 */
const AMENDMENT_TOKEN = randomUUID();

/**
 * Query options that let the amendment service update a signed or amended encounter (inside
 * its transaction `session`).
 */
export function amendmentWriteOptions(session?: ClientSession) {
  return { session, encounterAmendment: AMENDMENT_TOKEN };
}

/** Marks a loaded document so `save()` may write a signed note (amendment service only). */
export function allowAmendmentSave(doc: { $locals: Record<string, unknown> }) {
  doc.$locals.encounterAmendment = AMENDMENT_TOKEN;
}

const recordLocked = () =>
  new ApiError(
    409,
    'This note is signed and can only be changed by an amendment',
    ERROR_CODES.RECORD_LOCKED,
  );

const UPDATE_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
] as const;

/**
 * Updates through queries: refused if they match a signed/amended encounter, and restricted to
 * drafts (so a note signed between the check and the write is not touched either).
 */
encounterSchema.pre([...UPDATE_OPS], async function lockSigned() {
  const options = this.getOptions() as { encounterAmendment?: string; session?: never };
  if (options.encounterAmendment === AMENDMENT_TOKEN) return;
  const locked = await this.model
    .exists({ $and: [this.getFilter(), { status: { $ne: 'draft' } }] })
    .session(options.session ?? null);
  if (locked) throw recordLocked();
  this.where({ status: 'draft' });
});

encounterSchema.post('init', function rememberStatus() {
  this.$locals.loadedStatus = this.status;
});

encounterSchema.pre('save', function lockSignedDocument() {
  if (this.isNew) return;
  const loaded = this.$locals.loadedStatus as string | undefined;
  if (loaded !== 'draft' && this.$locals.encounterAmendment !== AMENDMENT_TOKEN) {
    throw recordLocked();
  }
});

encounterSchema.pre('validate', function syncBmi() {
  if (this.isModified('vitals.weightKg') || this.isModified('vitals.heightCm') || this.isNew) {
    if (this.vitals) {
      this.vitals.bmi = computeBmi(this.vitals.weightKg, this.vitals.heightCm) ?? undefined;
    }
  }
});

const deleteRefused = () => {
  throw new ApiError(409, 'Clinical notes cannot be deleted', ERROR_CODES.RECORD_LOCKED);
};
encounterSchema.pre(['deleteMany', 'findOneAndDelete'], deleteRefused);
encounterSchema.pre('deleteOne', { document: true, query: true }, deleteRefused);
// Bulk writes would skip the checks above.
encounterSchema.pre('bulkWrite', () => {
  throw new ApiError(409, 'Clinical notes cannot be bulk-written', ERROR_CODES.RECORD_LOCKED);
});

export type EncounterDoc = InferSchemaType<typeof encounterSchema>;

const createModel = () => mongoose.model('Encounter', encounterSchema);
export type EncounterModel = ReturnType<typeof createModel>;

export const Encounter: EncounterModel =
  (mongoose.models.Encounter as EncounterModel | undefined) ?? createModel();
