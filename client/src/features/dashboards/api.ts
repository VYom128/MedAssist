import { apiSlice } from '../../app/apiSlice';
import type { AppointmentStatus } from '../../constants/catalog';
import type { ApiSuccess } from '../../utils/http';
import type { FollowUpDue } from '../visits/api';

/**
 * One dashboard call per role (spec §14, server modules/dashboard): plain numbers – money in
 * paise, instants in UTC, ranges as clinic dates. Rates are fractions (0.125 = 12.5 %).
 */

type StatusCounts = Record<AppointmentStatus, number> & { total: number };
interface Range {
  from: string;
  to: string;
}

export interface AdminDashboard {
  ranges: { today: string; month: Range; lastMonth: Range; last30Days: Range };
  appointmentsToday: StatusCounts;
  revenue: {
    todayPaise: number;
    thisMonthPaise: number;
    lastMonthPaise: number;
    lastMonthToDatePaise: number;
    outstandingPaise: number;
    outstandingInvoices: number;
  };
  revenueTrend: { date: string; netPaise: number }[];
  newPatientsThisMonth: number;
  noShowRate30d: { completed: number; noShow: number; rate: number | null };
  doctorUtilisation: {
    doctorId: string;
    doctorName: string;
    availableMinutes: number;
    bookedMinutes: number;
    utilisation: number | null;
  }[];
  labTurnaround: {
    count: number;
    medianHours: number | null;
    p90Hours: number | null;
    averageHours: number | null;
    overdue: number;
  };
  auditAlerts: {
    id: string;
    at: string;
    action: string;
    actorRole: string | null;
    actorName: string | null;
    resourceType: string | null;
    resourceNumber: string | null;
  }[];
  ai: {
    calls: number;
    attempts: number;
    failed: number;
    blocked: number;
    tokens: number;
    today: { calls: number; limit: number };
  };
}

export interface ReceptionDashboard {
  today: string;
  appointmentsByDoctor: {
    doctorId: string;
    doctorName: string;
    total: number;
    scheduled: number;
    checkedIn: number;
    inConsultation: number;
    completed: number;
    cancelled: number;
    noShow: number;
  }[];
  checkInsWaiting: number;
  unpaidToday: {
    count: number;
    items: {
      id: string;
      invoiceNumber: string | null;
      status: string;
      balancePaise: number;
      issuedAt: string | null;
      patientName: string | null;
    }[];
  };
  openFollowups: number;
  upcoming: {
    id: string;
    appointmentNumber: string;
    startAt: string;
    status: AppointmentStatus;
    patientName: string | null;
    doctorName: string | null;
  }[];
}

export interface DoctorDashboard {
  today: string;
  queueToday: {
    waiting: number;
    inConsultation: number;
    done: number;
    scheduled: number;
    total: number;
  };
  nextPatient: {
    appointmentId: string;
    appointmentNumber: string;
    tokenNumber: number | null;
    priority: string;
    startAt: string;
    patientName: string | null;
  } | null;
  unsignedDrafts: {
    count: number;
    olderThan24h: number;
    documentationWindowHours: number;
    items: {
      encounterId: string;
      appointmentId: string;
      patientName: string | null;
      createdAt: string;
      olderThan24h: boolean;
    }[];
  };
  resultsToReview: {
    count: number;
    critical: number;
    items: {
      id: string;
      orderNumber: string | null;
      status: string;
      hasCritical: boolean;
      orderedAt: string | null;
      patientName: string | null;
    }[];
  };
  openFollowups: number;
  weekAppointments: { from: string; to: string; total: number; byStatus: StatusCounts };
}

export const LAB_OPEN_STATUSES = [
  'ordered',
  'sample_collected',
  'sample_rejected',
  'processing',
  'result_entered',
  'verified',
] as const;

export interface LabDashboard {
  today: string;
  countsByStatus: Record<(typeof LAB_OPEN_STATUSES)[number], number>;
  openTotal: number;
  urgentPending: number;
  overdueTat: number;
  collectedToday: number;
  releasedToday: number;
  pendingVerificationByOthers: number;
}

export interface PatientDashboard {
  today: string;
  nextAppointment: {
    id: string;
    appointmentNumber: string;
    startAt: string;
    status: AppointmentStatus;
    doctorName: string | null;
    department: string | null;
    queue: {
      tokenNumber: number | null;
      position: number;
      patientsAhead: number;
      estimatedWaitMinutes: number;
    } | null;
  } | null;
  activePrescriptions: {
    count: number;
    items: {
      id: string;
      prescriptionNumber: string | null;
      issuedAt: string | null;
      doctorName: string | null;
    }[];
  };
  newReports: {
    count: number;
    sinceDays: number;
    items: { id: string; orderNumber: string | null; releasedAt: string | null }[];
  };
  outstanding: { invoices: number; balancePaise: number };
  followUpsDue: FollowUpDue[];
  quickActions: { key: 'book_appointment' | 'request_follow_up'; link: string }[];
}

const tag = (id: string) => [{ type: 'Dashboard' as const, id }];
const data = <T>(res: ApiSuccess<T>) => res.data;

export const dashboardsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    getAdminDashboard: build.query<AdminDashboard, void>({
      query: () => ({ url: '/dashboard/admin' }),
      transformResponse: data<AdminDashboard>,
      providesTags: tag('admin'),
    }),
    getReceptionDashboard: build.query<ReceptionDashboard, void>({
      query: () => ({ url: '/dashboard/reception' }),
      transformResponse: data<ReceptionDashboard>,
      providesTags: tag('reception'),
    }),
    getDoctorDashboard: build.query<DoctorDashboard, void>({
      query: () => ({ url: '/dashboard/doctor' }),
      transformResponse: data<DoctorDashboard>,
      providesTags: tag('doctor'),
    }),
    getLabDashboard: build.query<LabDashboard, void>({
      query: () => ({ url: '/dashboard/lab' }),
      transformResponse: data<LabDashboard>,
      providesTags: tag('lab'),
    }),
    getPatientDashboard: build.query<PatientDashboard, void>({
      query: () => ({ url: '/dashboard/patient' }),
      transformResponse: data<PatientDashboard>,
      providesTags: tag('patient'),
    }),
  }),
});

export const {
  useGetAdminDashboardQuery,
  useGetReceptionDashboardQuery,
  useGetDoctorDashboardQuery,
  useGetLabDashboardQuery,
  useGetPatientDashboardQuery,
} = dashboardsApi;
