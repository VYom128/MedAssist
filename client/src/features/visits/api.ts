import { apiSlice } from '../../app/apiSlice';
import type { DiagnosisType, EncounterStatus } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';
import type { FollowUp, Vitals } from '../encounters/api';

/** The patient's own visits (Phase 8): server/src/modules/encounters patient views. */

type Ref = { id: string; name: string };

/** A signed note as the patient sees it – never history, examination, assessment or plan. */
export interface PatientVisit {
  id: string;
  encounterNumber: string;
  appointmentId: string;
  visitAt: string;
  signedAt: string | null;
  status: EncounterStatus;
  amended: boolean;
  doctor: Ref;
  department: Ref | null;
  vitals: Omit<Vitals, 'recordedAt' | 'recordedBy'>;
  /** Whether the doctor shared the diagnoses (`diagnoses` is null when not). */
  diagnosisShared: boolean;
  diagnoses:
    | { description: string; icd10Code: string | null; type: DiagnosisType; isPrimary: boolean }[]
    | null;
  adviceToPatient: string | null;
  followUp: FollowUp;
  prescriptionId: string | null;
  labOrders: { id: string; orderNumber: string | null }[];
}

export interface PatientVisitListItem {
  id: string;
  encounterNumber: string;
  visitAt: string;
  signedAt: string | null;
  status: EncounterStatus;
  doctor: Ref;
  department: Ref | null;
  /** Only when the doctor shared the diagnosis. */
  primaryDiagnosis: string | null;
}

/** A planned follow-up that is not booked yet (GET /patients/me/follow-ups-due). */
export interface FollowUpDue {
  encounterId: string;
  encounterNumber: string;
  visitAt: string;
  doctor: Ref;
  department: Ref | null;
  /** Clinic date 'YYYY-MM-DD'. */
  dueDate: string;
  overdue: boolean;
  instructions: string | null;
  booking: { doctorId: string; followUpOf: string; type: 'follow_up' };
}

const LIST = { type: 'Visit' as const, id: 'LIST' };
const DUE = { type: 'Visit' as const, id: 'FOLLOW_UPS_DUE' };

export const visitsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listMyVisits: build.query<Paged<PatientVisitListItem>, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/patients/me/visits', params }),
      transformResponse: toPaged<PatientVisitListItem>,
      providesTags: [LIST],
    }),
    getMyVisit: build.query<PatientVisit, string>({
      query: (id) => ({ url: `/encounters/${id}` }),
      transformResponse: (res: ApiSuccess<PatientVisit>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Visit', id }],
    }),
    listFollowUpsDue: build.query<FollowUpDue[], void>({
      query: () => ({ url: '/patients/me/follow-ups-due' }),
      transformResponse: (res: ApiSuccess<FollowUpDue[]>) => res.data,
      // A booking changes what is due.
      providesTags: [DUE, { type: 'AppointmentList', id: 'LIST' }],
    }),
  }),
});

export const { useListMyVisitsQuery, useGetMyVisitQuery, useListFollowUpsDueQuery } = visitsApi;

/** Query string for the booking wizard (`/patient/appointments/book?doctor=…&followUpOf=…`). */
export const followUpBookingLink = (due: Pick<FollowUpDue, 'booking'>) =>
  `/patient/appointments/book?${new URLSearchParams({
    doctor: due.booking.doctorId,
    followUpOf: due.booking.followUpOf,
  }).toString()}`;
