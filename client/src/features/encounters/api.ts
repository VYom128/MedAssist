import { apiSlice } from '../../app/apiSlice';
import type { DiagnosisType, EncounterStatus, NoteField, VitalKey } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';
import type { Prescription } from '../prescriptions/api';

/** Server shapes from server/src/modules/encounters (spec §6.13, §7.10). */

export type Vitals = Record<VitalKey | 'bmi', number | null> & {
  recordedAt: string | null;
  recordedBy: string | null;
};

export interface Diagnosis {
  description: string;
  icd10Code: string | null;
  type: DiagnosisType;
  isPrimary: boolean;
}

export interface FollowUp {
  required: boolean;
  afterDays: number | null;
  /** Clinic date 'YYYY-MM-DD'. */
  date: string | null;
  instructions: string | null;
}

interface EncounterBase {
  id: string;
  encounterNumber: string;
  appointmentId: string;
  patient: { id: string; mrn: string; fullName: string };
  doctor: { id: string; name: string };
  visitAt: string;
  status: EncounterStatus;
  /** Note version: 1 when signed, +1 per amendment. */
  version: number;
  signedAt: string | null;
  lastAmendedAt: string | null;
}

export interface EncounterListItem extends EncounterBase {
  /** Only in one patient's history (`?patient=`). */
  primaryDiagnosis?: string | null;
  updatedAt: string | null;
}

export interface Encounter extends EncounterBase {
  /** Send back as `expectedVersion` (optimistic concurrency). */
  revision: number;
  vitals: Vitals;
  chiefComplaint: string | null;
  historyOfPresentIllness: string | null;
  pastHistory: string | null;
  examination: string | null;
  diagnoses: Diagnosis[];
  assessment: string | null;
  plan: string | null;
  adviceToPatient: string | null;
  followUp: FollowUp;
  signedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Changes to the note (PATCH body without expectedVersion; also amendment `changes`). */
export interface NoteChanges {
  vitals?: Partial<Record<VitalKey, number | null>>;
  chiefComplaint?: string | null;
  historyOfPresentIllness?: string | null;
  pastHistory?: string | null;
  examination?: string | null;
  diagnoses?: Diagnosis[];
  assessment?: string | null;
  plan?: string | null;
  adviceToPatient?: string | null;
  followUp?: FollowUp;
}

export interface SignResult {
  encounter: Encounter;
  prescription: Prescription | null;
  appointment: { id: string; status: string };
  warnings: string[];
}

export interface Amendment {
  id: string;
  version: number;
  reason: string;
  changedFields: NoteField[];
  before: Partial<Record<NoteField, unknown>>;
  after: Partial<Record<NoteField, unknown>>;
  amendedBy: { id: string; name: string | null };
  amendedAt: string;
}

export interface AmendmentHistory {
  encounterId: string;
  currentVersion: number;
  signedAt: string | null;
  amendments: Amendment[];
}

export interface EncounterListParams {
  patient?: string;
  /** Only the caller's own notes. */
  mine?: boolean;
  status?: EncounterStatus;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

const data = <T>(res: ApiSuccess<T>) => res.data;
const one = (id: string) => ({ type: 'Encounter' as const, id });
const byAppointment = (appointmentId: string) => ({
  type: 'Encounter' as const,
  id: `appointment:${appointmentId}`,
});
const LIST = { type: 'EncounterList' as const, id: 'LIST' };

/** Encounters (spec §7.10). */
export const encountersApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getEncounterByAppointment: build.query<Encounter, string>({
      query: (appointmentId) => ({ url: `/appointments/${appointmentId}/encounter` }),
      transformResponse: data<Encounter>,
      providesTags: (result, _e, appointmentId) => [
        byAppointment(appointmentId),
        ...(result ? [one(result.id)] : []),
      ],
    }),
    getEncounter: build.query<Encounter, string>({
      query: (id) => ({ url: `/encounters/${id}` }),
      transformResponse: data<Encounter>,
      providesTags: (_r, _e, id) => [one(id)],
    }),
    listEncounters: build.query<Paged<EncounterListItem>, EncounterListParams>({
      query: (params) => ({ url: '/encounters', params }),
      transformResponse: toPaged<EncounterListItem>,
      providesTags: [LIST],
    }),
    /**
     * Autosave. The result is written straight into the cached note (no refetch while the doctor
     * types); lists refresh.
     */
    updateEncounter: build.mutation<
      Encounter,
      { id: string; body: NoteChanges & { expectedVersion: number } }
    >({
      query: ({ id, body }) => ({ url: `/encounters/${id}`, method: 'PATCH', data: body }),
      transformResponse: data<Encounter>,
      invalidatesTags: [LIST],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data: saved } = await queryFulfilled;
          dispatch(encountersApi.util.upsertQueryData('getEncounter', saved.id, saved));
          dispatch(
            encountersApi.util.upsertQueryData(
              'getEncounterByAppointment',
              saved.appointmentId,
              saved,
            ),
          );
        } catch {
          // The caller handles the error.
        }
      },
    }),
    signEncounter: build.mutation<SignResult, { id: string; expectedVersion: number }>({
      query: ({ id, expectedVersion }) => ({
        url: `/encounters/${id}/sign`,
        method: 'POST',
        data: { expectedVersion },
      }),
      transformResponse: data<SignResult>,
      invalidatesTags: (result, _e, { id }) => [
        one(id),
        LIST,
        { type: 'PrescriptionList', id: 'LIST' },
        ...(result
          ? [
              byAppointment(result.appointment.id),
              { type: 'Appointment' as const, id: result.appointment.id },
              ...(result.prescription
                ? [{ type: 'Prescription' as const, id: result.prescription.id }]
                : []),
            ]
          : []),
        { type: 'Queue', id: 'LIST' },
        { type: 'AppointmentList', id: 'LIST' },
        { type: 'Calendar', id: 'LIST' },
        'QueueBoard',
      ],
    }),
    amendEncounter: build.mutation<Encounter, { id: string; reason: string; changes: NoteChanges }>(
      {
        query: ({ id, ...body }) => ({
          url: `/encounters/${id}/amendments`,
          method: 'POST',
          data: body,
        }),
        transformResponse: data<Encounter>,
        invalidatesTags: (result, _e, { id }) => [
          one(id),
          LIST,
          { type: 'Amendment', id },
          ...(result ? [byAppointment(result.appointmentId)] : []),
        ],
      },
    ),
    listAmendments: build.query<AmendmentHistory, string>({
      query: (id) => ({ url: `/encounters/${id}/amendments` }),
      transformResponse: data<AmendmentHistory>,
      providesTags: (_r, _e, id) => [{ type: 'Amendment', id }],
    }),
  }),
});

export const {
  useGetEncounterByAppointmentQuery,
  useGetEncounterQuery,
  useListEncountersQuery,
  useUpdateEncounterMutation,
  useSignEncounterMutation,
  useAmendEncounterMutation,
  useListAmendmentsQuery,
} = encountersApi;
