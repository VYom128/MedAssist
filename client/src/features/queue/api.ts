import { apiSlice } from '../../app/apiSlice';
import type {
  AppointmentPriority,
  AppointmentStatus,
  AppointmentType,
} from '../../constants/catalog';
import type { ApiSuccess } from '../../utils/http';
import type { Appointment } from '../appointments/api';

/** Server shapes from server/src/modules/queue (spec §7.9). */

export interface QueueItem {
  appointmentId: string;
  appointmentNumber: string;
  tokenNumber: number | null;
  status: AppointmentStatus;
  patient: { id: string; shortName: string; mrn: string };
  priority: AppointmentPriority;
  type: AppointmentType;
  isOverbook: boolean;
  scheduledAt: string;
  checkedInAt: string | null;
  calledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  waitMinutes: number | null;
  position: number | null;
  estimatedWaitMinutes: number | null;
}

export interface Queue {
  doctor: { id: string; name: string; roomNumber: string | null };
  date: string;
  averageConsultMinutes: number;
  averageBasis: 'history' | 'slot';
  waiting: QueueItem[];
  inConsultation: QueueItem[];
  done: QueueItem[];
}

export interface MyPosition {
  appointmentId: string;
  appointmentNumber: string;
  tokenNumber: number | null;
  status: AppointmentStatus;
  position: number;
  patientsAhead: number;
  estimatedWaitMinutes: number;
  doctor: { id: string; name: string; roomNumber: string | null };
  checkedInAt: string | null;
}

export interface QueueBoard {
  date: string;
  updatedAt: string;
  doctors: {
    doctorName: string;
    roomNumber: string | null;
    nowServing: number | null;
    next: number[];
    waitingCount: number;
  }[];
}

const data = <T>(res: ApiSuccess<T>) => res.data;
/** Queue cache ids: `<doctorId>:<date>` (matches the socket event), plus 'me' for my-position. */
export const queueTag = (doctorId: string, date: string) => ({
  type: 'Queue' as const,
  id: `${doctorId}:${date}`,
});
const QUEUE = { type: 'Queue' as const, id: 'LIST' };
const affected = (id: string) => [
  { type: 'Appointment' as const, id },
  QUEUE,
  { type: 'AppointmentList' as const, id: 'LIST' },
  { type: 'Calendar' as const, id: 'LIST' },
  'QueueBoard' as const,
];

/** The queue (spec §7.9). */
export const queueApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getQueue: build.query<Queue, { doctor?: string; date?: string }>({
      query: (params) => ({ url: '/queue', params }),
      transformResponse: data<Queue>,
      providesTags: (result) =>
        result ? [QUEUE, queueTag(result.doctor.id, result.date)] : [QUEUE],
    }),
    callNext: build.mutation<Appointment | null, void>({
      query: () => ({ url: '/queue/call-next', method: 'POST', data: {} }),
      transformResponse: data<Appointment | null>,
      invalidatesTags: (result) => (result ? affected(result.id) : [QUEUE]),
    }),
    setQueuePriority: build.mutation<
      Appointment,
      { appointmentId: string; priority: AppointmentPriority; reason: string }
    >({
      query: ({ appointmentId, ...body }) => ({
        url: `/queue/${appointmentId}/priority`,
        method: 'POST',
        data: body,
      }),
      transformResponse: data<Appointment>,
      invalidatesTags: (_r, _e, { appointmentId }) => affected(appointmentId),
    }),
    myPosition: build.query<MyPosition | null, void>({
      query: () => ({ url: '/queue/my-position' }),
      transformResponse: data<MyPosition | null>,
      providesTags: [QUEUE, { type: 'Queue', id: 'me' }],
    }),
    getQueueBoard: build.query<QueueBoard, string>({
      query: (key) => ({ url: '/queue/board', params: { key } }),
      transformResponse: data<QueueBoard>,
      providesTags: ['QueueBoard'],
    }),
  }),
});

export const {
  useGetQueueQuery,
  useCallNextMutation,
  useSetQueuePriorityMutation,
  useMyPositionQuery,
  useGetQueueBoardQuery,
} = queueApi;
