import { apiSlice } from '../../app/apiSlice';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';
import type { Appointment } from '../appointments/api';

/** Server shapes from server/src/modules/followups (spec §6.18, §7.13, Phase 8). */

export const FOLLOWUP_STATUSES = [
  'open',
  'in_review',
  'responded',
  'scheduled',
  'closed',
  'rejected',
] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const FOLLOWUP_TYPES = [
  'question',
  'new_or_worse_symptoms',
  'report_review',
  'refill_request',
  'reschedule',
  'other',
] as const;
export type FollowupType = (typeof FOLLOWUP_TYPES)[number];
/** Waiting for the clinic or the patient. */
export const OPEN_STATUSES: readonly FollowupStatus[] = ['open', 'in_review', 'responded'];
/** Nothing more happens on these. */
export const FINAL_STATUSES: readonly FollowupStatus[] = ['scheduled', 'closed', 'rejected'];

export interface FollowupMessage {
  id: string;
  from: { id: string | null; name: string | null; role: string };
  text: string;
  /** 'staff' = internal note (never sent to patients by the server). */
  visibility: 'all' | 'staff';
  at: string;
}

export interface FollowupListItem {
  id: string;
  requestNumber: string;
  type: FollowupType;
  status: FollowupStatus;
  patient: { id: string; mrn: string | null; fullName: string | null };
  assignedDoctor: { id: string; name: string | null } | null;
  relatedAppointmentId: string | null;
  resultingAppointmentId: string | null;
  /** Clinic date 'YYYY-MM-DD'. */
  preferredDate: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Followup extends FollowupListItem {
  message: string;
  attachments: {
    id: string | null;
    title: string | null;
    category: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
  }[];
  messages: FollowupMessage[];
  closedReason: string | null;
  statusHistory: { status: FollowupStatus; at: string; by?: string | null; note?: string | null }[];
}

export interface FollowupListParams {
  status?: string;
  type?: FollowupType;
  assignedDoctor?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface NewFollowupBody {
  relatedAppointmentId?: string;
  type: FollowupType;
  message: string;
  preferredDate?: string;
  attachmentIds?: string[];
}

const data = <T>(res: ApiSuccess<T>) => res.data;
const one = (id: string) => ({ type: 'FollowUp' as const, id });
const LIST = { type: 'FollowUpList' as const, id: 'LIST' };
/** What a change to a request refreshes: it, the lists, timelines. */
const changed = (id?: string) => [...(id ? [one(id)] : []), LIST, 'Timeline' as const];

export const followupsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listFollowups: build.query<Paged<FollowupListItem>, FollowupListParams>({
      query: (params) => ({ url: '/follow-up-requests', params }),
      transformResponse: toPaged<FollowupListItem>,
      providesTags: [LIST],
    }),
    getFollowup: build.query<Followup, string>({
      query: (id) => ({ url: `/follow-up-requests/${id}` }),
      transformResponse: data<Followup>,
      providesTags: (_r, _e, id) => [one(id)],
    }),
    createFollowup: build.mutation<Followup, NewFollowupBody>({
      query: (body) => ({ url: '/follow-up-requests', method: 'POST', data: body }),
      transformResponse: data<Followup>,
      invalidatesTags: changed(),
    }),
    postFollowupMessage: build.mutation<
      Followup,
      { id: string; text: string; visibility?: 'all' | 'staff' }
    >({
      query: ({ id, ...body }) => ({
        url: `/follow-up-requests/${id}/messages`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<Followup>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    reviewFollowup: build.mutation<Followup, string>({
      query: (id) => ({ url: `/follow-up-requests/${id}/review`, method: 'POST' }),
      transformResponse: data<Followup>,
      invalidatesTags: (_r, _e, id) => changed(id),
    }),
    assignFollowup: build.mutation<Followup, { id: string; doctorId: string }>({
      query: ({ id, doctorId }) => ({
        url: `/follow-up-requests/${id}/assign`,
        method: 'POST',
        data: { doctorId },
      }),
      transformResponse: data<Followup>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    scheduleFollowup: build.mutation<
      { request: Followup; appointment: Appointment },
      { id: string; startAt: string; serviceId: string; doctorId?: string }
    >({
      query: ({ id, ...body }) => ({
        url: `/follow-up-requests/${id}/schedule`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<{ request: Followup; appointment: Appointment }>,
      invalidatesTags: (_r, _e, { id }) => [
        ...changed(id),
        { type: 'AppointmentList', id: 'LIST' },
        'Calendar',
        'Slots',
        'Availability',
      ],
    }),
    finishFollowup: build.mutation<
      Followup,
      { id: string; outcome: 'close' | 'reject'; reason: string }
    >({
      query: ({ id, outcome, reason }) => ({
        url: `/follow-up-requests/${id}/${outcome}`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<Followup>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
  }),
});

export const {
  useListFollowupsQuery,
  useGetFollowupQuery,
  useCreateFollowupMutation,
  usePostFollowupMessageMutation,
  useReviewFollowupMutation,
  useAssignFollowupMutation,
  useScheduleFollowupMutation,
  useFinishFollowupMutation,
} = followupsApi;
