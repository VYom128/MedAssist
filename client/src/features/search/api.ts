import { apiSlice } from '../../app/apiSlice';
import type { ApiSuccess } from '../../utils/http';

/**
 * Global search (spec §12.1, server modules/search): only the groups the role may see, at most
 * 5 each, exact matches first. Results carry numbers, names, dates and statuses – never clinical
 * details or amounts – and `link`, the caller's own page for the record (null: no page).
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 250;

export type SearchGroup = 'patients' | 'appointments' | 'invoices' | 'labOrders';

export interface PatientResult {
  id: string;
  mrn: string | null;
  name: string | null;
  link: string | null;
}
export interface AppointmentResult {
  id: string;
  number: string;
  startAt: string;
  status: string;
  patientName: string | null;
  doctorName: string | null;
  link: string | null;
}
export interface InvoiceResult {
  id: string;
  number: string | null;
  status: string;
  issuedAt: string | null;
  patientName: string | null;
  link: string | null;
}
export interface LabOrderResult {
  id: string;
  number: string | null;
  sampleId: string | null;
  status: string;
  orderedAt: string | null;
  patientName: string | null;
  patientMrn: string | null;
  link: string | null;
}

export interface SearchResults {
  groups: SearchGroup[];
  patients?: PatientResult[];
  appointments?: AppointmentResult[];
  invoices?: InvoiceResult[];
  labOrders?: LabOrderResult[];
}

export const searchApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    search: build.query<SearchResults, string>({
      query: (q) => ({ url: '/search', params: { q } }),
      transformResponse: (res: ApiSuccess<SearchResults>) => res.data,
      // Results go stale fast and may name patients: keep them only briefly.
      keepUnusedDataFor: 10,
    }),
  }),
});

export const { useSearchQuery } = searchApi;
