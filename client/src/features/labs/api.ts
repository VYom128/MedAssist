import { apiSlice } from '../../app/apiSlice';
import type {
  AllergySeverity,
  Gender,
  LabFlag,
  LabItemStatus,
  LabOrderStatus,
  LabPriority,
  LabSampleType,
} from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Server shapes from server/src/modules/labOrders/serializer.ts (spec §6.20, §7.14). */

export interface Person {
  id: string;
  name: string | null;
}

export interface LabResult {
  parameterKey: string;
  name: string;
  unit: string | null;
  value: number | string | null;
  referenceText: string | null;
  flag: LabFlag;
}

export interface PreviousVersion {
  version: number;
  results: LabResult[];
  remarks: string | null;
  revisedBy: string | null;
  revisedAt: string | null;
  reason: string | null;
}

export interface PendingRevision {
  results: LabResult[];
  remarks: string | null;
  reason: string | null;
  by: string | null;
  at: string;
}

export interface Cancellation {
  by: string | null;
  at: string;
  reason: string | null;
}

/**
 * One ordered test. The lab sees everything; doctors get `resultsAvailable`/`unverified`/
 * `revisionPending` instead of the pending revision's values.
 */
export interface LabItem {
  id: string;
  testId: string;
  code: string;
  name: string;
  status: LabItemStatus;
  results: LabResult[];
  remarks: string | null;
  resultVersion: number;
  previousResults: PreviousVersion[];
  cancellation: Cancellation | null;
  // Lab view
  sampleType?: LabSampleType | null;
  turnaroundHours?: number | null;
  pendingRevision?: PendingRevision | null;
  enteredBy?: Person | null;
  enteredAt?: string | null;
  verifiedBy?: Person | null;
  verifiedAt?: string | null;
  // Doctor view
  resultsAvailable?: boolean;
  unverified?: boolean;
  correctedAt?: string | null;
  revisionPending?: boolean;
}

export interface LabPatient {
  id: string;
  mrn: string;
  fullName: string;
  age: number;
  gender: Gender;
  /** Lab view only (safety information). */
  allergies?: { substance: string; reaction: string | null; severity: AllergySeverity }[];
}

export interface LabSample {
  sampleId: string | null;
  type: string | null;
  collectedAt: string | null;
  collectedBy: Person | null;
  patientAgeYears?: number | null;
  rejection: { reason: string | null; at: string } | null;
}

export interface StatusEntry {
  status: LabOrderStatus;
  at: string;
  by: string | null;
  note: string | null;
}

/** The label printed on the sample tube (collect-sample response). */
export interface SampleLabel {
  sampleId: string | null;
  orderNumber: string | null;
  priority: LabPriority;
  patient: { fullName: string; mrn: string; age: number | null; gender: Gender };
  sampleType: string | null;
  collectedAt: string | null;
  tests: { code: string; name: string }[];
}

/** GET /lab-orders/:id for lab technicians and doctors. */
export interface LabOrder {
  id: string;
  orderNumber: string | null;
  status: LabOrderStatus;
  priority: LabPriority;
  orderedAt: string | null;
  createdAt: string | null;
  orderedBy: { id: string; name: string };
  encounterId: string;
  appointmentId: string;
  patient: LabPatient;
  clinicalNotes: string | null;
  sample: LabSample | null;
  items: LabItem[];
  hasCritical: boolean;
  releasedAt: string | null;
  reportAvailable: boolean;
  cancellation: Cancellation | null;
  statusHistory: StatusEntry[];
  revision: number;
  // Lab view
  requireDualVerification?: boolean;
  tatBreachedAt?: string | null;
  releasedBy?: Person | null;
  label?: SampleLabel;
  // Doctor view
  reviewedByDoctorAt?: string | null;
}

/** One row of GET /lab-orders (lab technician or doctor). */
export interface LabOrderListItem {
  id: string;
  orderNumber: string | null;
  status: LabOrderStatus;
  priority: LabPriority;
  orderedAt: string | null;
  createdAt: string | null;
  orderedBy: { id: string; name: string };
  encounterId: string;
  appointmentId: string;
  patient: { id: string; mrn: string; fullName: string; age?: number; gender?: Gender };
  tests: { id?: string; code: string; name: string; status?: LabItemStatus }[];
  hasCritical: boolean;
  // Lab
  sampleId?: string | null;
  tatBreachedAt?: string | null;
  // Doctor
  releasedAt?: string | null;
  reviewedByDoctorAt?: string | null;
  flags?: { abnormal: number; critical: number };
}

export interface LabOrderListParams {
  status?: string;
  priority?: LabPriority;
  patient?: string;
  appointment?: string;
  encounter?: string;
  from?: string;
  to?: string;
  releasedOn?: string;
  q?: string;
  needsReview?: boolean;
  page?: number;
  limit?: number;
}

export interface LabOrderInput {
  encounterId: string;
  testIds: string[];
  priority: LabPriority;
  clinicalNotes?: string | null;
}

export interface ResultInput {
  parameterKey: string;
  value: number | string | null;
}

/** Actions without a body (spec §7.14). */
export type LabAction =
  'collect-sample' | 'recollect' | 'start-processing' | 'verify' | 'release' | 'acknowledge';

const LIST = { type: 'LabWorklist' as const, id: 'LIST' };
const one = (id: string) => ({ type: 'LabOrder' as const, id });
const data = <T>(res: ApiSuccess<T>) => res.data;
/** Everything a change of order `id` can affect. */
const changed = (id: string) => [one(id), LIST];

/** Lab orders (spec §7.14): ordering (doctors), the lab workflow (lab techs), reads. */
export const labsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listLabOrders: build.query<Paged<LabOrderListItem>, LabOrderListParams>({
      query: ({ needsReview, ...params }) => ({
        url: '/lab-orders',
        params: { ...params, ...(needsReview ? { needsReview: 'true' } : {}) },
      }),
      transformResponse: (res: ApiSuccess<LabOrderListItem[]>) => toPaged(res),
      providesTags: (result) => [LIST, ...(result?.items.map((o) => one(o.id)) ?? [])],
    }),
    getLabOrder: build.query<LabOrder, string>({
      query: (id) => ({ url: `/lab-orders/${id}` }),
      transformResponse: data<LabOrder>,
      providesTags: (_r, _e, id) => [one(id)],
    }),
    createLabOrder: build.mutation<LabOrder, LabOrderInput>({
      query: (body) => ({ url: '/lab-orders', method: 'POST', data: body }),
      transformResponse: data<LabOrder>,
      invalidatesTags: [LIST],
    }),
    updateLabOrder: build.mutation<
      LabOrder,
      { id: string; body: Partial<Omit<LabOrderInput, 'encounterId'>> }
    >({
      query: ({ id, body }) => ({ url: `/lab-orders/${id}`, method: 'PATCH', data: body }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    discardLabOrder: build.mutation<LabOrder, string>({
      query: (id) => ({ url: `/lab-orders/${id}/discard`, method: 'POST' }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, id) => changed(id),
    }),
    cancelLabOrder: build.mutation<LabOrder, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/lab-orders/${id}/cancel`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    cancelLabItem: build.mutation<LabOrder, { id: string; itemId: string; reason: string }>({
      query: ({ id, itemId, reason }) => ({
        url: `/lab-orders/${id}/items/${itemId}/cancel`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    labAction: build.mutation<LabOrder, { id: string; action: LabAction }>({
      query: ({ id, action }) => ({ url: `/lab-orders/${id}/${action}`, method: 'POST' }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id, action }) => [
        ...changed(id),
        ...(action === 'release' ? [{ type: 'Document' as const, id: 'LIST' }] : []),
      ],
    }),
    labReasonAction: build.mutation<
      LabOrder,
      { id: string; action: 'reject-sample' | 'send-back'; reason: string }
    >({
      query: ({ id, action, reason }) => ({
        url: `/lab-orders/${id}/${action}`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    saveResults: build.mutation<
      LabOrder,
      { id: string; itemId: string; results: ResultInput[]; remarks?: string | null }
    >({
      query: ({ id, itemId, results, remarks }) => ({
        url: `/lab-orders/${id}/items/${itemId}/results`,
        method: 'PUT',
        data: { results, ...(remarks !== undefined ? { remarks } : {}) },
      }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    reviseItem: build.mutation<
      LabOrder,
      {
        id: string;
        itemId: string;
        results: ResultInput[];
        remarks?: string | null;
        reason: string;
      }
    >({
      query: ({ id, itemId, ...body }) => ({
        url: `/lab-orders/${id}/items/${itemId}/revise`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => [...changed(id), { type: 'Document', id: 'LIST' }],
    }),
    verifyRevision: build.mutation<LabOrder, { id: string; itemId: string }>({
      query: ({ id, itemId }) => ({
        url: `/lab-orders/${id}/items/${itemId}/verify-revision`,
        method: 'POST',
      }),
      transformResponse: data<LabOrder>,
      invalidatesTags: (_r, _e, { id }) => [...changed(id), { type: 'Document', id: 'LIST' }],
    }),
  }),
});

export const {
  useListLabOrdersQuery,
  useGetLabOrderQuery,
  useLazyGetLabOrderQuery,
  useCreateLabOrderMutation,
  useUpdateLabOrderMutation,
  useDiscardLabOrderMutation,
  useCancelLabOrderMutation,
  useCancelLabItemMutation,
  useLabActionMutation,
  useLabReasonActionMutation,
  useSaveResultsMutation,
  useReviseItemMutation,
  useVerifyRevisionMutation,
} = labsApi;

/** The report PDF of a released order (download through useDownload). */
export const reportUrl = (id: string) => `/lab-orders/${id}/report.pdf`;
