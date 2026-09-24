import { apiSlice } from '../../app/apiSlice';
import type { AllergySeverity, BloodGroup, Gender, PatientLanguage } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Server shapes from server/src/modules/patients/serializer.ts. */

export interface PatientListItem {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number;
  gender: Gender;
  isActive: boolean;
  phone: string;
  hasPortal: boolean;
  /** Doctors' list (`scope=mine`): last visit (in consultation or completed) and last booking. */
  lastVisitAt?: string | null;
  lastAppointmentAt?: string;
}

export interface Address {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface EmergencyContact {
  name?: string | null;
  relation?: string | null;
  phone?: string | null;
}

export interface Allergy {
  id: string;
  substance: string;
  reaction: string | null;
  severity: AllergySeverity;
  recordedBy: string | null;
  recordedAt: string | null;
}

export interface ChronicCondition {
  id: string;
  name: string;
  since: string | null;
  notes: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
}

export interface Insurance {
  provider: string | null;
  policyNumber: string | null;
  validTill: string | null;
}

export interface Consent {
  dataProcessing: { given: boolean; at: string | null };
  aiExplanations: { given: boolean; at: string | null };
  communications: { email: boolean; sms: boolean };
}

export interface PortalInfo {
  hasAccount: boolean;
  email: string | null;
  linkStatus: 'linked' | 'pending_verification' | null;
  lastLoginAt: string | null;
}

/**
 * One patient as the caller's role sees it (spec §2.5): admins get no allergies or chronic
 * conditions, receptionists no chronic conditions, patients no admin notes or portal info.
 */
export interface Patient extends PatientListItem {
  /** 'YYYY-MM-DD' */
  dateOfBirth: string;
  bloodGroup: BloodGroup;
  email: string | null;
  address: Address | null;
  emergencyContact: EmergencyContact | null;
  preferredLanguage: PatientLanguage;
  consent: Consent;
  registeredAt: string | null;
  updatedAt: string | null;
  insurance?: Insurance | null;
  adminNotes?: string | null;
  allergies?: Allergy[];
  chronicConditions?: ChronicCondition[];
  portal?: PortalInfo;
}

export interface DuplicateMatch {
  id: string;
  mrn: string;
  fullName: string;
  dateOfBirth: string;
  phone: string;
  isActive: boolean;
  matchedOn: ('phone_dob' | 'name_dob')[];
}

export interface PendingLink {
  userId: string;
  isActive: boolean;
  signup: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    dateOfBirth: string | null;
    registeredAt: string | null;
  };
  patient: {
    id: string;
    mrn: string;
    fullName: string;
    dateOfBirth: string;
    phone: string;
    isActive: boolean;
  } | null;
}

export interface PatientListParams {
  /** Doctors: the patients they have a care relationship with. */
  scope?: 'mine';
  page?: number;
  limit?: number;
  q?: string;
  gender?: Gender;
  ageMin?: number;
  ageMax?: number;
  hasPortal?: boolean;
  isActive?: boolean;
  sort?: string;
}

export interface DuplicateQuery {
  dateOfBirth: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

export interface AllergyInput {
  id?: string;
  substance: string;
  reaction: string | null;
  severity: AllergySeverity;
}

/** Body of POST /patients and PATCH /patients/:id (see schemas.ts toPatientBody). */
export interface PatientBody {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: Gender;
  bloodGroup?: BloodGroup;
  phone?: string;
  email?: string | null;
  address?: Address | null;
  emergencyContact?: EmergencyContact | null;
  insurance?: {
    provider: string | null;
    policyNumber: string | null;
    validTill: string | null;
  } | null;
  preferredLanguage?: PatientLanguage;
  adminNotes?: string | null;
  allergies?: AllergyInput[];
  consent?: {
    dataProcessing: true;
    aiExplanations?: boolean;
    communications?: { email?: boolean; sms?: boolean };
  };
  force?: boolean;
  reason?: string;
}

/** Body of PATCH /patients/me. */
export interface MyDetailsBody {
  phone?: string;
  email?: string | null;
  address?: Address | null;
  emergencyContact?: EmergencyContact | null;
  preferredLanguage?: PatientLanguage;
  consent?: { aiExplanations?: boolean; communications?: { email?: boolean; sms?: boolean } };
}

const listTag = { type: 'PatientList' as const, id: 'LIST' };
const pendingTag = { type: 'PendingLink' as const, id: 'LIST' };
const one = (id: string) => ({ type: 'Patient' as const, id });
const data = <T>(res: ApiSuccess<T>) => res.data;

/** Patients (spec §7.7). */
export const patientsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listPatients: build.query<Paged<PatientListItem>, PatientListParams>({
      query: (params) => ({ url: '/patients', params }),
      transformResponse: toPaged<PatientListItem>,
      providesTags: [listTag],
    }),
    checkDuplicate: build.query<{ matches: DuplicateMatch[] }, DuplicateQuery>({
      query: (params) => ({ url: '/patients/check-duplicate', params }),
      transformResponse: data<{ matches: DuplicateMatch[] }>,
    }),
    createPatient: build.mutation<Patient, PatientBody>({
      query: (body) => ({ url: '/patients', method: 'POST', data: body }),
      transformResponse: data<Patient>,
      invalidatesTags: [listTag],
    }),
    getPatient: build.query<Patient, string>({
      query: (id) => ({ url: `/patients/${id}` }),
      transformResponse: data<Patient>,
      providesTags: (_r, _e, id) => [one(id)],
    }),
    updatePatient: build.mutation<Patient, { id: string; body: PatientBody }>({
      query: ({ id, body }) => ({ url: `/patients/${id}`, method: 'PATCH', data: body }),
      transformResponse: data<Patient>,
      invalidatesTags: (_r, _e, { id }) => [listTag, one(id)],
    }),
    updateClinicalProfile: build.mutation<
      Patient,
      {
        id: string;
        body: {
          allergies?: AllergyInput[];
          chronicConditions?: {
            id?: string;
            name: string;
            since?: string | null;
            notes?: string | null;
          }[];
        };
      }
    >({
      query: ({ id, body }) => ({
        url: `/patients/${id}/clinical-profile`,
        method: 'PATCH',
        data: body,
      }),
      transformResponse: data<Patient>,
      invalidatesTags: (_r, _e, { id }) => [one(id)],
    }),
    setPatientActive: build.mutation<
      Patient,
      { id: string; action: 'deactivate' | 'activate'; reason: string }
    >({
      query: ({ id, action, reason }) => ({
        url: `/patients/${id}/${action}`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: data<Patient>,
      invalidatesTags: (_r, _e, { id }) => [listTag, one(id)],
    }),
    pendingLinks: build.query<Paged<PendingLink>, { page?: number; limit?: number }>({
      query: (params) => ({ url: '/patients/pending-links', params }),
      transformResponse: toPaged<PendingLink>,
      providesTags: [pendingTag],
    }),
    confirmLink: build.mutation<Patient, { patientId: string; userId: string }>({
      query: ({ patientId, userId }) => ({
        url: `/patients/${patientId}/confirm-link`,
        method: 'POST',
        data: { userId },
      }),
      transformResponse: data<Patient>,
      invalidatesTags: (_r, _e, { patientId }) => [pendingTag, listTag, one(patientId)],
    }),
    rejectLink: build.mutation<Patient, { patientId: string; userId: string; reason: string }>({
      query: ({ patientId, userId, reason }) => ({
        url: `/patients/${patientId}/reject-link`,
        method: 'POST',
        data: { userId, reason },
      }),
      transformResponse: data<Patient>,
      invalidatesTags: (_r, _e, { patientId }) => [pendingTag, listTag, one(patientId)],
    }),
    portalInvite: build.mutation<Patient, string>({
      query: (id) => ({ url: `/patients/${id}/portal-invite`, method: 'POST' }),
      transformResponse: data<Patient>,
      invalidatesTags: (_r, _e, id) => [listTag, one(id)],
    }),
    getMyPatient: build.query<Patient, void>({
      query: () => ({ url: '/patients/me' }),
      transformResponse: data<Patient>,
      providesTags: [one('me')],
    }),
    updateMyPatient: build.mutation<Patient, MyDetailsBody>({
      query: (body) => ({ url: '/patients/me', method: 'PATCH', data: body }),
      transformResponse: data<Patient>,
      invalidatesTags: [one('me')],
    }),
  }),
});

export const {
  useListPatientsQuery,
  useLazyCheckDuplicateQuery,
  useCreatePatientMutation,
  useGetPatientQuery,
  useUpdatePatientMutation,
  useUpdateClinicalProfileMutation,
  useSetPatientActiveMutation,
  usePendingLinksQuery,
  useConfirmLinkMutation,
  useRejectLinkMutation,
  usePortalInviteMutation,
  useGetMyPatientQuery,
  useUpdateMyPatientMutation,
} = patientsApi;
