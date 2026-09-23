import { apiSlice } from '../../app/apiSlice';
import type { ExplanationLanguage, PaymentMethod } from '../../constants/catalog';
import { setClinicTimezone } from '../../utils/clinicTimezone';
import type { ApiSuccess } from '../../utils/http';

export interface Address {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

/** `GET /settings/public` (server settings `toPublicView`). */
export interface PublicSettings {
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  address: Address;
  phone: string | null;
  email: string | null;
  website: string | null;
  timezone: string;
  currency: string;
  workingDays: number[];
  appointment: { allowPatientSelfBooking: boolean; bookingWindowDays: number };
  ai: { explanationLanguages: ExplanationLanguage[] };
}

/** `GET /settings` (admin, `toAdminView`). Money in paise, tax in basis points. */
export interface AdminSettings extends Omit<PublicSettings, 'appointment' | 'ai'> {
  registrationNumber: string | null;
  gstin: string | null;
  appointment: {
    defaultSlotMinutes: number;
    bookingWindowDays: number;
    minCancelHours: number;
    allowPatientSelfBooking: boolean;
    maxActiveBookingsPerPatient: number;
    walkInOverbookPerSession: number;
    noShowGraceMinutes: number;
    reminderHoursBefore: number;
  };
  billing: {
    invoicePrefix: string;
    defaultTaxRateBps: number;
    taxLabel: string;
    maxDiscountPercentWithoutAdmin: number;
    paymentMethods: PaymentMethod[];
    invoiceFooter: string | null;
  };
  lab: { requireDualVerification: boolean; criticalAlertEnabled: boolean };
  ai: {
    enabled: boolean;
    clinicalSummaryEnabled: boolean;
    patientExplanationEnabled: boolean;
    explanationLanguages: ExplanationLanguage[];
  };
  notifications: { emailEnabled: boolean };
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Deep partial body of `PATCH /settings`. */
export type SettingsPatch = { [K in keyof AdminSettings]?: unknown };

/** Clinic settings (spec §7.4). */
export const settingsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    /** Loaded once at app start (main.tsx) and kept; also sets the clinic timezone for dates. */
    getPublicSettings: build.query<PublicSettings, void>({
      query: () => ({ url: '/settings/public' }),
      transformResponse: (res: ApiSuccess<PublicSettings>) => res.data,
      providesTags: [{ type: 'Settings', id: 'PUBLIC' }],
      async onQueryStarted(_arg, { queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          setClinicTimezone(data.timezone);
        } catch {
          // Keep the fallback timezone; pages still work.
        }
      },
    }),
    getSettings: build.query<AdminSettings, void>({
      query: () => ({ url: '/settings' }),
      transformResponse: (res: ApiSuccess<AdminSettings>) => res.data,
      providesTags: [{ type: 'Settings', id: 'ADMIN' }],
    }),
    updateSettings: build.mutation<AdminSettings, SettingsPatch>({
      query: (body) => ({ url: '/settings', method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<AdminSettings>) => res.data,
      invalidatesTags: ['Settings', 'AuditLog'],
    }),
  }),
});

export const { useGetPublicSettingsQuery, useGetSettingsQuery, useUpdateSettingsMutation } =
  settingsApi;
