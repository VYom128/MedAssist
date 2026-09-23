import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { EXPLANATION_LANGUAGES, PAYMENT_METHODS } from '../../config/constants.js';

const { ObjectId } = Schema.Types;

/** Key of the one settings document. */
export const SETTINGS_KEY = 'clinic';

const addressSchema = new Schema(
  {
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: { type: String, default: 'India' },
  },
  { _id: false },
);

/**
 * Clinic settings (spec §6.5): a single document (`key: 'clinic'`). Money in paise, tax rates
 * in basis points (1800 = 18 %). Read through settings.service, which caches it.
 */
const clinicSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: SETTINGS_KEY, immutable: true },
    name: { type: String, required: true, trim: true, default: 'MedAssist Clinic' },
    logoUrl: String, // a URL until uploads arrive in Phase 6
    tagline: String,
    registrationNumber: String,
    gstin: String,
    address: { type: addressSchema, default: () => ({}) },
    phone: String,
    email: String,
    website: String,
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    currency: { type: String, required: true, default: 'INR' },
    workingDays: { type: [Number], default: () => [1, 2, 3, 4, 5, 6] }, // 0 = Sunday
    appointment: {
      defaultSlotMinutes: { type: Number, default: 15 },
      bookingWindowDays: { type: Number, default: 30 },
      minCancelHours: { type: Number, default: 2 },
      allowPatientSelfBooking: { type: Boolean, default: true },
      maxActiveBookingsPerPatient: { type: Number, default: 3 },
      walkInOverbookPerSession: { type: Number, default: 2 },
      noShowGraceMinutes: { type: Number, default: 30 },
      reminderHoursBefore: { type: Number, default: 24 },
    },
    billing: {
      invoicePrefix: { type: String, default: 'INV' },
      defaultTaxRateBps: { type: Number, default: 0 },
      taxLabel: { type: String, default: 'GST' },
      maxDiscountPercentWithoutAdmin: { type: Number, default: 10 },
      paymentMethods: {
        type: [{ type: String, enum: PAYMENT_METHODS }],
        default: () => [...PAYMENT_METHODS],
      },
      invoiceFooter: String,
    },
    lab: {
      requireDualVerification: { type: Boolean, default: true },
      criticalAlertEnabled: { type: Boolean, default: true },
    },
    ai: {
      enabled: { type: Boolean, default: true },
      clinicalSummaryEnabled: { type: Boolean, default: true },
      patientExplanationEnabled: { type: Boolean, default: true },
      explanationLanguages: {
        type: [{ type: String, enum: EXPLANATION_LANGUAGES }],
        default: () => [...EXPLANATION_LANGUAGES],
      },
    },
    notifications: {
      emailEnabled: { type: Boolean, default: true },
    },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'clinic_settings' },
);

export type ClinicSettingsDoc = InferSchemaType<typeof clinicSettingsSchema>;

const createModel = () => mongoose.model('ClinicSettings', clinicSettingsSchema);
export type ClinicSettingsModel = ReturnType<typeof createModel>;

export const ClinicSettings: ClinicSettingsModel =
  (mongoose.models.ClinicSettings as ClinicSettingsModel | undefined) ?? createModel();
