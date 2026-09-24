import { apiSlice } from '../../app/apiSlice';
import type { LeaveType } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';
import type { AffectedAppointment } from '../appointments/api';

/** Public doctor view (spec §7.6). `id` is the doctor's User id. */
export interface PublicDoctor {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  department: { id: string; name: string; code: string } | null;
  specialization: string;
  qualifications: string[];
  experienceYears: number | null;
  consultationFeePaise: number | null;
  languages: string[];
  bio: string | null;
  isAcceptingAppointments: boolean;
}

/** Admin view (also what a doctor gets for their own profile). */
export interface AdminDoctor extends PublicDoctor {
  email: string;
  phone: string | null;
  registrationNumber: string;
  roomNumber: string | null;
  slotMinutes: number | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Either view: admin-only fields are present only for admins and the doctor themselves. */
export type Doctor = PublicDoctor & Partial<Omit<AdminDoctor, keyof PublicDoctor>>;

export interface DoctorListParams {
  page?: number;
  limit?: number;
  q?: string;
  department?: string;
  accepting?: boolean;
  includeInactive?: boolean;
}

export interface DoctorProfileInput {
  department: string;
  specialization: string;
  qualifications: string[];
  registrationNumber: string;
  experienceYears: number | null;
  consultationFeePaise: number | null;
  slotMinutes: number | null;
  roomNumber: string;
  bio: string;
  languages: string[];
  isAcceptingAppointments?: boolean;
}

export interface CreateDoctorInput extends DoctorProfileInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

export interface Session {
  start: string;
  end: string;
  maxWalkIns?: number;
}

export interface ScheduleVersion {
  effectiveFrom: string;
  effectiveTo: string | null;
  days: { weekday: number; sessions: Required<Session>[] }[];
}

export interface ScheduleView {
  current: ScheduleVersion | null;
  upcoming: ScheduleVersion | null;
}

export interface ScheduleSaveResult extends ScheduleView {
  warnings: { weekday: number; message: string }[];
  affectedAppointments: AffectedAppointment[];
}

export interface ScheduleInput {
  effectiveFrom: string;
  days: { weekday: number; sessions: Session[] }[];
}

export interface Leave {
  id: string;
  doctorId: string;
  startAt: string;
  endAt: string;
  type: LeaveType;
  reason: string | null;
  isCancelled: boolean;
  cancelledAt: string | null;
  createdAt: string | null;
}

export type LeaveInput =
  | { startAt: string; endAt: string; type: LeaveType; reason?: string }
  | { date: string; endDate?: string; fullDay: true; type: LeaveType; reason?: string };

export interface LeaveListParams {
  from?: string;
  to?: string;
  includeCancelled?: boolean;
  limit?: number;
}

const listTag = { type: 'Doctor' as const, id: 'LIST' };

/** Doctors, weekly schedules and leave (spec §7.6). */
export const doctorsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listDoctors: build.query<Paged<Doctor>, DoctorListParams>({
      query: (params) => ({ url: '/doctors', params }),
      transformResponse: (res: ApiSuccess<Doctor[]>) => toPaged(res),
      providesTags: (result) => [
        listTag,
        ...(result?.items.map((d) => ({ type: 'Doctor' as const, id: d.id })) ?? []),
      ],
    }),
    getDoctor: build.query<Doctor, string>({
      query: (id) => ({ url: `/doctors/${id}` }),
      transformResponse: (res: ApiSuccess<Doctor>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Doctor', id }],
    }),
    createDoctor: build.mutation<AdminDoctor, CreateDoctorInput>({
      query: (body) => ({ url: '/doctors', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<AdminDoctor>) => res.data,
      invalidatesTags: [listTag, 'Department', 'User', 'AuditLog'],
    }),
    updateDoctor: build.mutation<AdminDoctor, { id: string; body: Partial<DoctorProfileInput> }>({
      query: ({ id, body }) => ({ url: `/doctors/${id}`, method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<AdminDoctor>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [
        listTag,
        { type: 'Doctor', id },
        'Department',
        'AuditLog',
      ],
    }),
    /** Account status goes through the users endpoints (the doctor's User id). */
    doctorAccountAction: build.mutation<unknown, { id: string; action: 'activate' | 'deactivate' }>(
      {
        query: ({ id, action }) => ({ url: `/users/${id}/${action}`, method: 'POST' }),
        invalidatesTags: (_r, _e, { id }) => [
          listTag,
          { type: 'Doctor', id },
          { type: 'User', id },
          'Department',
          'AuditLog',
        ],
      },
    ),
    getSchedule: build.query<ScheduleView, string>({
      query: (id) => ({ url: `/doctors/${id}/schedule` }),
      transformResponse: (res: ApiSuccess<ScheduleView>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Schedule', id }],
    }),
    replaceSchedule: build.mutation<ScheduleSaveResult, { id: string; body: ScheduleInput }>({
      query: ({ id, body }) => ({ url: `/doctors/${id}/schedule`, method: 'PUT', data: body }),
      transformResponse: (res: ApiSuccess<ScheduleSaveResult>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Schedule', id },
        'AuditLog',
        'Slots',
        'Availability',
      ],
    }),
    listLeaves: build.query<Paged<Leave>, { id: string; params: LeaveListParams }>({
      query: ({ id, params }) => ({ url: `/doctors/${id}/leaves`, params }),
      transformResponse: (res: ApiSuccess<Leave[]>) => toPaged(res),
      providesTags: (_r, _e, { id }) => [{ type: 'Leave', id }],
    }),
    createLeave: build.mutation<
      { leave: Leave; affectedAppointments: AffectedAppointment[] },
      { id: string; body: LeaveInput }
    >({
      query: ({ id, body }) => ({ url: `/doctors/${id}/leaves`, method: 'POST', data: body }),
      transformResponse: (
        res: ApiSuccess<{ leave: Leave; affectedAppointments: AffectedAppointment[] }>,
      ) => res.data,
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'Leave', id },
        'AuditLog',
        'Slots',
        'Availability',
      ],
    }),
    cancelLeave: build.mutation<Leave, { id: string; leaveId: string }>({
      query: ({ id, leaveId }) => ({
        url: `/doctors/${id}/leaves/${leaveId}/cancel`,
        method: 'POST',
      }),
      transformResponse: (res: ApiSuccess<Leave>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Leave', id }, 'AuditLog'],
    }),
  }),
});

export const {
  useListDoctorsQuery,
  useGetDoctorQuery,
  useCreateDoctorMutation,
  useUpdateDoctorMutation,
  useDoctorAccountActionMutation,
  useGetScheduleQuery,
  useReplaceScheduleMutation,
  useListLeavesQuery,
  useCreateLeaveMutation,
  useCancelLeaveMutation,
} = doctorsApi;
