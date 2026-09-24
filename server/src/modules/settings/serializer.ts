import type { Types } from 'mongoose';
import type { ClinicSettingsDoc } from './model.js';

export type SettingsLike = ClinicSettingsDoc & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const address = (s: SettingsLike) => ({
  line1: s.address?.line1 ?? null,
  line2: s.address?.line2 ?? null,
  city: s.address?.city ?? null,
  state: s.address?.state ?? null,
  postalCode: s.address?.postalCode ?? null,
  country: s.address?.country ?? null,
});

/** GET /settings/public – what anyone may see (spec §7.4). */
export function toPublicView(s: SettingsLike) {
  return {
    name: s.name,
    logoUrl: s.logoUrl ?? null,
    tagline: s.tagline ?? null,
    address: address(s),
    phone: s.phone ?? null,
    email: s.email ?? null,
    website: s.website ?? null,
    timezone: s.timezone,
    currency: s.currency,
    workingDays: [...s.workingDays],
    appointment: {
      allowPatientSelfBooking: s.appointment!.allowPatientSelfBooking,
      bookingWindowDays: s.appointment!.bookingWindowDays,
      // Phase 4: the patient portal hides cancel/reschedule inside this window.
      minCancelHours: s.appointment!.minCancelHours,
    },
    ai: { explanationLanguages: [...s.ai!.explanationLanguages] },
  };
}

/** GET/PATCH /settings – every setting (admin). */
export function toAdminView(s: SettingsLike) {
  const a = s.appointment!;
  const b = s.billing!;
  return {
    ...toPublicView(s),
    registrationNumber: s.registrationNumber ?? null,
    gstin: s.gstin ?? null,
    appointment: {
      defaultSlotMinutes: a.defaultSlotMinutes,
      bookingWindowDays: a.bookingWindowDays,
      minCancelHours: a.minCancelHours,
      allowPatientSelfBooking: a.allowPatientSelfBooking,
      maxActiveBookingsPerPatient: a.maxActiveBookingsPerPatient,
      walkInOverbookPerSession: a.walkInOverbookPerSession,
      noShowGraceMinutes: a.noShowGraceMinutes,
      reminderHoursBefore: a.reminderHoursBefore,
    },
    billing: {
      invoicePrefix: b.invoicePrefix,
      defaultTaxRateBps: b.defaultTaxRateBps,
      taxLabel: b.taxLabel,
      maxDiscountPercentWithoutAdmin: b.maxDiscountPercentWithoutAdmin,
      paymentMethods: [...b.paymentMethods],
      invoiceFooter: b.invoiceFooter ?? null,
    },
    lab: {
      requireDualVerification: s.lab!.requireDualVerification,
      criticalAlertEnabled: s.lab!.criticalAlertEnabled,
    },
    ai: {
      enabled: s.ai!.enabled,
      clinicalSummaryEnabled: s.ai!.clinicalSummaryEnabled,
      patientExplanationEnabled: s.ai!.patientExplanationEnabled,
      explanationLanguages: [...s.ai!.explanationLanguages],
    },
    notifications: { emailEnabled: s.notifications!.emailEnabled },
    updatedBy: s.updatedBy?.toString() ?? null,
    updatedAt: s.updatedAt ?? null,
  };
}
