import { apiSlice } from '../../app/apiSlice';
import type {
  AppointmentPriority,
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
  Gender,
} from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Server shapes from server/src/modules/appointments/serializer.ts (views differ per role). */

export interface AppointmentPatient {
  id: string;
  mrn: string;
  fullName: string;
  age: number;
  gender: Gender;
  /** Reception and admins only. */
  phone?: string | null;
}

export interface StatusHistoryEntry {
  status: AppointmentStatus;
  at: string;
  by: string | null;
  note: string | null;
}

export interface RescheduleEntry {
  fromStartAt: string;
  toStartAt: string;
  fromDoctor?: string | null;
  toDoctor?: string | null;
  by?: string | null;
  byRole?: string | null;
  at: string;
  reason?: string | null;
}

export interface PriorityEntry {
  from: AppointmentPriority;
  to: AppointmentPriority;
  by: string | null;
  at: string;
  reason: string | null;
}

export interface Appointment {
  id: string;
  appointmentNumber: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  type: AppointmentType;
  source: AppointmentSource;
  reason: string | null;
  doctor: { id: string; name: string };
  department: { id: string; name: string } | null;
  service: { id: string | null; name: string; durationMinutes: number; pricePaise: number };
  followUpOf: string | null;
  tokenNumber: number | null;
  checkedInAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Staff and doctor views. */
  patient?: AppointmentPatient;
  priority?: AppointmentPriority;
  isOverbook?: boolean;
  queue?: {
    tokenNumber: number | null;
    checkedInAt: string | null;
    calledAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  cancellation?: {
    at: string;
    by?: string | null;
    byRole?: string | null;
    byYou?: boolean;
    reason: string | null;
  } | null;
  rescheduleHistory?: RescheduleEntry[];
  priorityHistory?: PriorityEntry[];
  statusHistory?: StatusHistoryEntry[];
  bookedBy?: string | null;
}

/** GET /appointments/calendar */
export interface CalendarEvent {
  id: string;
  appointmentNumber: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  type: AppointmentType;
  priority: AppointmentPriority;
  isOverbook: boolean;
  doctorId: string;
  patientShortName: string;
}

export interface Slot {
  startAt: string;
  endAt: string;
  /** Clinic wall-clock 'HH:mm'. */
  label: string;
}

export interface SlotsResult {
  date: string;
  timezone: string;
  slotMinutes: number;
  serviceMinutes: number;
  slots: Slot[];
}

export interface AvailabilityResult {
  timezone: string;
  slotMinutes: number;
  serviceMinutes: number;
  days: { date: string; freeSlots: number }[];
}

/** An appointment affected by doctor leave or a schedule change (spec §4.13). */
export interface AffectedAppointment {
  id: string;
  appointmentNumber: string;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  patientShortName: string | null;
}

export interface AppointmentListParams {
  page?: number;
  limit?: number;
  /** Clinic dates 'YYYY-MM-DD'. */
  from?: string;
  to?: string;
  doctor?: string;
  patient?: string;
  department?: string;
  /** Comma-separated statuses. */
  status?: string;
  type?: AppointmentType;
  q?: string;
  sort?: string;
}

export interface BookingBody {
  patientId?: string;
  doctorId: string;
  serviceId: string;
  /** ISO instant. */
  startAt: string;
  type?: 'new' | 'follow_up';
  reason?: string | null;
  followUpOf?: string;
}

export interface WalkInBody {
  patientId: string;
  doctorId: string;
  serviceId: string;
  reason?: string | null;
  priority?: AppointmentPriority;
}

/** Status actions without a body (POST /appointments/:id/<action>). */
export type AppointmentAction = 'check-in' | 'start' | 'complete' | 'no-show' | 'undo-no-show';

const data = <T>(res: ApiSuccess<T>) => res.data;
const one = (id: string) => ({ type: 'Appointment' as const, id });
const LIST = { type: 'AppointmentList' as const, id: 'LIST' };
const CALENDAR = { type: 'Calendar' as const, id: 'LIST' };
const SLOTS = { type: 'Slots' as const, id: 'LIST' };
const AVAILABILITY = { type: 'Availability' as const, id: 'LIST' };
const QUEUE = { type: 'Queue' as const, id: 'LIST' };

/** Everything an appointment change can affect: lists, calendars, free slots, queues. */
const changed = (id?: string) => [
  ...(id ? [one(id)] : []),
  LIST,
  CALENDAR,
  SLOTS,
  AVAILABILITY,
  QUEUE,
  'QueueBoard' as const,
];

/** Dates from `from` to `to` inclusive ('YYYY-MM-DD'). */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to;) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Appointments, slots and availability (spec §7.6, §7.8). */
export const appointmentsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listAppointments: build.query<Paged<Appointment>, AppointmentListParams>({
      query: (params) => ({ url: '/appointments', params }),
      transformResponse: toPaged<Appointment>,
      providesTags: [LIST],
    }),
    getCalendar: build.query<CalendarEvent[], { from: string; to: string; doctor?: string }>({
      query: (params) => ({ url: '/appointments/calendar', params }),
      transformResponse: data<CalendarEvent[]>,
      // One tag per clinic date, so a socket event for a date refreshes only calendars showing it.
      providesTags: (_r, _e, { from, to }) => [
        CALENDAR,
        ...datesBetween(from, to).map((date) => ({ type: 'Calendar' as const, id: date })),
      ],
    }),
    getAppointment: build.query<Appointment, string>({
      query: (id) => ({ url: `/appointments/${id}` }),
      transformResponse: data<Appointment>,
      providesTags: (_r, _e, id) => [one(id)],
    }),
    bookAppointment: build.mutation<Appointment, BookingBody>({
      query: (body) => ({ url: '/appointments', method: 'POST', data: body }),
      transformResponse: data<Appointment>,
      invalidatesTags: changed(),
    }),
    walkIn: build.mutation<Appointment, WalkInBody>({
      query: (body) => ({ url: '/appointments/walk-in', method: 'POST', data: body }),
      transformResponse: data<Appointment>,
      invalidatesTags: changed(),
    }),
    updateAppointment: build.mutation<
      Appointment,
      { id: string; body: { reason?: string | null; priority?: AppointmentPriority } }
    >({
      query: ({ id, body }) => ({ url: `/appointments/${id}`, method: 'PATCH', data: body }),
      transformResponse: data<Appointment>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    rescheduleAppointment: build.mutation<
      Appointment,
      {
        id: string;
        body: { startAt: string; doctorId?: string; serviceId?: string; reason?: string };
      }
    >({
      query: ({ id, body }) => ({
        url: `/appointments/${id}/reschedule`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<Appointment>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    cancelAppointment: build.mutation<Appointment, { id: string; reason?: string }>({
      query: ({ id, reason }) => ({
        url: `/appointments/${id}/cancel`,
        method: 'POST',
        data: reason ? { reason } : {},
      }),
      transformResponse: data<Appointment>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    appointmentAction: build.mutation<Appointment, { id: string; action: AppointmentAction }>({
      query: ({ id, action }) => ({
        url: `/appointments/${id}/${action}`,
        method: 'POST',
        data: {},
      }),
      transformResponse: data<Appointment>,
      invalidatesTags: (_r, _e, { id }) => changed(id),
    }),
    getSlots: build.query<SlotsResult, { doctorId: string; date: string; serviceId?: string }>({
      query: ({ doctorId, ...params }) => ({ url: `/doctors/${doctorId}/slots`, params }),
      transformResponse: data<SlotsResult>,
      providesTags: (_r, _e, { doctorId, date }) => [
        SLOTS,
        { type: 'Slots', id: `${doctorId}:${date}` },
      ],
    }),
    getAvailability: build.query<
      AvailabilityResult,
      { doctorId: string; from: string; to: string; serviceId?: string }
    >({
      query: ({ doctorId, ...params }) => ({ url: `/doctors/${doctorId}/availability`, params }),
      transformResponse: data<AvailabilityResult>,
      providesTags: (_r, _e, { doctorId }) => [
        AVAILABILITY,
        { type: 'Availability', id: doctorId },
      ],
    }),
  }),
});

export const {
  useListAppointmentsQuery,
  useGetCalendarQuery,
  useGetAppointmentQuery,
  useBookAppointmentMutation,
  useWalkInMutation,
  useUpdateAppointmentMutation,
  useRescheduleAppointmentMutation,
  useCancelAppointmentMutation,
  useAppointmentActionMutation,
  useGetSlotsQuery,
  useGetAvailabilityQuery,
} = appointmentsApi;
