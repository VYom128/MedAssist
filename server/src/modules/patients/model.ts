import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  ALLERGY_SEVERITIES,
  BLOOD_GROUPS,
  GENDERS,
  PATIENT_LANGUAGES,
} from '../../config/constants.js';
import { ageOn, calendarDateString, clinicToday, isValidDateOfBirth } from '../../utils/dates.js';
import { cachedTimezone } from '../settings/service.js';

const { ObjectId } = Schema.Types;

/** 'Priya  Sharma ' → 'priya sharma': the duplicate-check key (spec §4.3 name + DOB). */
export function nameKeyOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

const addressSchema = new Schema(
  {
    line1: { type: String, trim: true, maxlength: 120 },
    line2: { type: String, trim: true, maxlength: 120 },
    city: { type: String, trim: true, maxlength: 60 },
    state: { type: String, trim: true, maxlength: 60 },
    postalCode: { type: String, trim: true, maxlength: 12 },
    country: { type: String, trim: true, maxlength: 60 },
  },
  { _id: false },
);

const emergencyContactSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    relation: { type: String, trim: true, maxlength: 40 },
    phone: { type: String, trim: true }, // E.164
  },
  { _id: false },
);

/** An allergy (safety information): recorded by reception or the patient's doctor. */
const allergySchema = new Schema({
  substance: { type: String, required: true, trim: true, maxlength: 100 },
  reaction: { type: String, trim: true, maxlength: 200 },
  severity: { type: String, enum: ALLERGY_SEVERITIES, required: true },
  recordedBy: { type: ObjectId, ref: 'User' },
  recordedAt: Date,
});

/** A chronic condition (clinical): recorded by the patient's doctor only. */
const chronicConditionSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  since: Date, // calendar date
  notes: { type: String, trim: true, maxlength: 500 },
  recordedBy: { type: ObjectId, ref: 'User' },
  recordedAt: Date,
});

const consentSchema = new Schema(
  {
    dataProcessing: { given: { type: Boolean, default: false }, at: Date },
    aiExplanations: { given: { type: Boolean, default: false }, at: Date },
    communications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
    },
  },
  { _id: false },
);

/**
 * Patient record (spec §6.11). Phone is E.164; `dateOfBirth` is a calendar date (UTC midnight);
 * `nameKey` (lower-case "first last", single spaces) is kept in sync by the service for the
 * name + DOB duplicate check. `user` is the linked portal account (set once linked, §4.4).
 */
const patientSchema = new Schema(
  {
    mrn: { type: String, required: true, unique: true, immutable: true },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    nameKey: { type: String, required: true },
    dateOfBirth: {
      type: Date,
      required: true,
      validate: {
        validator: (d: Date) => isValidDateOfBirth(calendarDateString(d)),
        message: 'Date of birth must be in the past and at most 120 years ago',
      },
    },
    gender: { type: String, enum: GENDERS, required: true },
    bloodGroup: { type: String, enum: BLOOD_GROUPS, default: 'unknown' },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    address: addressSchema,
    emergencyContact: emergencyContactSchema,
    allergies: { type: [allergySchema], default: [] },
    chronicConditions: { type: [chronicConditionSchema], default: [] },
    insurance: {
      type: new Schema(
        {
          provider: { type: String, trim: true, maxlength: 100 },
          policyNumber: { type: String, trim: true, maxlength: 60 },
          validTill: Date, // calendar date
        },
        { _id: false },
      ),
    },
    preferredLanguage: { type: String, enum: PATIENT_LANGUAGES, default: 'en' },
    consent: { type: consentSchema, default: () => ({}) },
    user: { type: ObjectId, ref: 'User' },
    adminNotes: { type: String, trim: true, maxlength: 2000 }, // front desk, not clinical
    isActive: { type: Boolean, default: true },
    mergedInto: { type: ObjectId, ref: 'Patient' }, // stretch: duplicate merge
    registeredBy: { type: ObjectId, ref: 'User' },
    /** Bumped inside booking/reschedule transactions (the patient's booking lock). */
    bookingVersion: { type: Number, default: 0 },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    virtuals: {
      fullName: {
        get(this: { firstName: string; lastName: string }) {
          return `${this.firstName} ${this.lastName}`;
        },
      },
      age: {
        /** Whole years today in the clinic timezone. */
        get(this: { dateOfBirth?: Date }) {
          return this.dateOfBirth
            ? ageOn(this.dateOfBirth, clinicToday(cachedTimezone()))
            : undefined;
        },
      },
    },
    toJSON: { virtuals: true, versionKey: false },
  },
);

// Keeps nameKey right for document saves; update queries set it in the service.
patientSchema.pre('validate', function setNameKey() {
  if (this.firstName && this.lastName) this.nameKey = nameKeyOf(this.firstName, this.lastName);
});

patientSchema.index({ phone: 1, dateOfBirth: 1 }); // duplicate check, self-signup match
patientSchema.index({ nameKey: 1, dateOfBirth: 1 }); // duplicate check
patientSchema.index({ lastName: 1, firstName: 1 }); // name prefix search, sorting
patientSchema.index({ isActive: 1, createdAt: -1 });
patientSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } },
);
patientSchema.index(
  { firstName: 'text', lastName: 'text', mrn: 'text', phone: 'text', email: 'text' },
  { name: 'patient_text' },
);

export type PatientDoc = InferSchemaType<typeof patientSchema>;

const createModel = () => mongoose.model('Patient', patientSchema);
export type PatientModel = ReturnType<typeof createModel>;

export const Patient: PatientModel =
  (mongoose.models.Patient as PatientModel | undefined) ?? createModel();
