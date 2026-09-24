import { apiSlice } from '../../app/apiSlice';
import type {
  DrugFrequency,
  DrugTiming,
  Gender,
  PrescriptionStatus,
} from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Server shapes from server/src/modules/prescriptions (spec §6.16, §7.12). */

export interface AllergyWarning {
  substance: string;
  matchedOn: 'drug' | 'class';
  drugClass: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export interface PrescriptionItem {
  drugName: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  route: string | null;
  frequency: DrugFrequency | null;
  frequencyText: string | null;
  /** 'Three times a day', or the text for 'other'. */
  frequencyLabel: string | null;
  timing: DrugTiming | null;
  durationDays: number | null;
  quantity: string | null;
  instructions: string | null;
  /** Doctor view only. */
  allergyWarning?: AllergyWarning | null;
}

export interface AllergyWarningSummary {
  itemIndex: number;
  drugName: string;
  substance: string;
  matchedOn: 'drug' | 'class';
  drugClass: string | null;
  acknowledged: boolean;
}

export interface Prescription {
  id: string;
  prescriptionNumber: string | null;
  status: PrescriptionStatus;
  encounterId: string;
  appointmentId: string;
  doctor: { id: string; name: string };
  issuedAt: string | null;
  completedAt: string | null;
  generalInstructions: string | null;
  items: PrescriptionItem[];
  /** Doctor and print views. */
  patient?: { id: string; mrn: string; fullName: string; age: number; gender: Gender };
  /** Doctor view only. */
  isCurrent?: boolean;
  revision?: number;
  allergyWarnings?: AllergyWarningSummary[];
  allergyCheckNotice?: string;
  cancellation?: { by: string | null; at: string; reason: string | null } | null;
  replaces?: string | null;
}

export interface PrescriptionListItem {
  id: string;
  prescriptionNumber: string | null;
  status: PrescriptionStatus;
  doctor: { id: string; name: string };
  patient?: { id: string; mrn: string; fullName: string };
  isCurrent?: boolean;
  encounterId: string;
  appointmentId: string;
  itemCount: number;
  issuedAt: string | null;
  createdAt: string | null;
}

export interface PrescriptionListParams {
  patient?: string;
  appointment?: string;
  encounter?: string;
  status?: PrescriptionStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** One draft item as sent (PUT /encounters/:id/prescription). */
export interface PrescriptionItemInput {
  drugName: string;
  genericName?: string | null;
  strength?: string | null;
  form?: string | null;
  dose?: string | null;
  route?: string | null;
  frequency?: DrugFrequency | null;
  frequencyText?: string | null;
  timing?: DrugTiming | null;
  durationDays?: number | null;
  quantity?: string | null;
  instructions?: string | null;
  acknowledgeAllergy?: boolean;
}

export interface FormularyDrug {
  name: string;
  genericName: string;
  strengths: string[];
  forms: string[];
  route: string;
  doseHint: string | null;
  frequencyHint: DrugFrequency | null;
  frequencyHintLabel: string | null;
}

const data = <T>(res: ApiSuccess<T>) => res.data;
const one = (id: string) => ({ type: 'Prescription' as const, id });
const LIST = { type: 'PrescriptionList' as const, id: 'LIST' };

/** Prescriptions (spec §7.12) and the formulary. */
export const prescriptionsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listPrescriptions: build.query<Paged<PrescriptionListItem>, PrescriptionListParams>({
      query: (params) => ({ url: '/prescriptions', params }),
      transformResponse: toPaged<PrescriptionListItem>,
      providesTags: [LIST],
    }),
    getPrescription: build.query<Prescription, string>({
      query: (id) => ({ url: `/prescriptions/${id}` }),
      transformResponse: data<Prescription>,
      providesTags: (_r, _e, id) => [one(id)],
    }),
    putPrescriptionDraft: build.mutation<
      Prescription,
      {
        encounterId: string;
        expectedVersion?: number;
        items: PrescriptionItemInput[];
        generalInstructions?: string | null;
      }
    >({
      query: ({ encounterId, ...body }) => ({
        url: `/encounters/${encounterId}/prescription`,
        method: 'PUT',
        data: body,
      }),
      transformResponse: data<Prescription>,
      invalidatesTags: [LIST],
      // The saved draft goes straight into the cache (no refetch while the doctor edits).
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data: saved } = await queryFulfilled;
          dispatch(prescriptionsApi.util.upsertQueryData('getPrescription', saved.id, saved));
        } catch {
          // The caller handles the error.
        }
      },
    }),
    cancelPrescription: build.mutation<Prescription, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/prescriptions/${id}/cancel`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<Prescription>,
      invalidatesTags: (_r, _e, { id }) => [LIST, one(id)],
    }),
    reissuePrescription: build.mutation<Prescription, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/prescriptions/${id}/reissue`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<Prescription>,
      invalidatesTags: (_r, _e, { id }) => [LIST, one(id)],
    }),
    issuePrescription: build.mutation<Prescription, { id: string; expectedVersion?: number }>({
      query: ({ id, expectedVersion }) => ({
        url: `/prescriptions/${id}/issue`,
        method: 'POST',
        data: expectedVersion === undefined ? {} : { expectedVersion },
      }),
      transformResponse: data<Prescription>,
      invalidatesTags: (_r, _e, { id }) => [LIST, one(id)],
    }),
    searchFormulary: build.query<FormularyDrug[], { q: string; limit?: number }>({
      query: (params) => ({ url: '/formulary', params }),
      transformResponse: data<FormularyDrug[]>,
      keepUnusedDataFor: 300,
    }),
  }),
});

export const {
  useListPrescriptionsQuery,
  useGetPrescriptionQuery,
  usePutPrescriptionDraftMutation,
  useCancelPrescriptionMutation,
  useReissuePrescriptionMutation,
  useIssuePrescriptionMutation,
  useSearchFormularyQuery,
} = prescriptionsApi;

/** GET /prescriptions/:id/print – the printed sheet (spec §12.3). */
export interface PrintSheet extends Omit<Prescription, 'doctor'> {
  clinic: {
    name: string;
    address: {
      line1: string | null;
      line2: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
      country: string | null;
    };
    phone: string | null;
    email: string | null;
    registrationNumber: string | null;
    gstin: string | null;
  };
  doctor: {
    id: string;
    name: string;
    qualifications: string[];
    specialization: string | null;
    registrationNumber: string | null;
  };
  visitAt: string | null;
  followUp: {
    required: boolean;
    afterDays: number | null;
    date: string | null;
    instructions: string | null;
  };
}

const printApi = prescriptionsApi.injectEndpoints({
  endpoints: (build) => ({
    getPrintSheet: build.query<PrintSheet, string>({
      query: (id) => ({ url: `/prescriptions/${id}/print` }),
      transformResponse: (res: ApiSuccess<PrintSheet>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Prescription', id }],
    }),
  }),
});

export const { useGetPrintSheetQuery } = printApi;
