import type {
  AdminDashboard,
  DoctorDashboard,
  LabDashboard,
  PatientDashboard,
  ReceptionDashboard,
} from '../src/features/dashboards/api';
import type { NotificationItem } from '../src/features/notifications/api';

/** Dashboard and notification shapes as the server sends them (Phase 10). */

const counts = (over: Partial<Record<string, number>> = {}) => {
  const c = {
    scheduled: 0,
    checked_in: 0,
    in_consultation: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0,
    ...over,
  };
  return { ...c, total: Object.values(c).reduce((s, n) => s + n, 0) };
};

export function adminDashboard(over: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    ranges: {
      today: '2026-10-13',
      month: { from: '2026-10-01', to: '2026-10-13' },
      lastMonth: { from: '2026-09-01', to: '2026-09-30' },
      last30Days: { from: '2026-09-14', to: '2026-10-13' },
    },
    appointmentsToday: counts({ scheduled: 4, checked_in: 2, completed: 3, no_show: 1 }),
    revenue: {
      todayPaise: 125_050,
      thisMonthPaise: 1_200_000,
      lastMonthPaise: 2_000_000,
      lastMonthToDatePaise: 1_000_000,
      outstandingPaise: 4_550_000,
      outstandingInvoices: 7,
    },
    revenueTrend: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10),
      netPaise: i === 29 ? 125_050 : 50_000,
    })),
    newPatientsThisMonth: 12,
    noShowRate30d: { completed: 45, noShow: 5, rate: 0.1 },
    doctorUtilisation: [
      {
        doctorId: 'd1',
        doctorName: 'Dr Asha Mehta',
        availableMinutes: 1000,
        bookedMinutes: 800,
        utilisation: 0.8,
      },
      {
        doctorId: 'd2',
        doctorName: 'Dr Ravi Iyer',
        availableMinutes: 1000,
        bookedMinutes: 450,
        utilisation: 0.45,
      },
    ],
    labTurnaround: { count: 20, medianHours: 6.5, p90Hours: 20.2, averageHours: 8, overdue: 2 },
    auditAlerts: [
      {
        id: 'a1',
        at: '2026-10-13T04:30:00.000Z',
        action: 'access.denied',
        actorRole: 'doctor',
        actorName: 'Dr Neha Shah',
        resourceType: 'patient',
        resourceNumber: 'MRN-2026-000123',
      },
    ],
    ai: {
      calls: 40,
      attempts: 44,
      failed: 2,
      blocked: 1,
      tokens: 12_000,
      today: { calls: 3, limit: 200 },
    },
    ...over,
  };
}

export function receptionDashboard(over: Partial<ReceptionDashboard> = {}): ReceptionDashboard {
  return {
    today: '2026-10-13',
    appointmentsByDoctor: [
      {
        doctorId: 'd1',
        doctorName: 'Dr Asha Mehta',
        total: 6,
        scheduled: 2,
        checkedIn: 2,
        inConsultation: 1,
        completed: 1,
        cancelled: 0,
        noShow: 0,
      },
    ],
    checkInsWaiting: 2,
    unpaidToday: {
      count: 1,
      items: [
        {
          id: 'inv1',
          invoiceNumber: 'INV-2026-000042',
          status: 'issued',
          balancePaise: 75_000,
          issuedAt: '2026-10-13T05:00:00.000Z',
          patientName: 'Kavya Rao',
        },
      ],
    },
    openFollowups: 3,
    upcoming: [
      {
        id: 'apt1',
        appointmentNumber: 'APT-2026-000100',
        startAt: '2026-10-13T06:30:00.000Z',
        status: 'scheduled',
        patientName: 'Arjun Nair',
        doctorName: 'Dr Asha Mehta',
      },
    ],
    ...over,
  };
}

export function doctorDashboard(over: Partial<DoctorDashboard> = {}): DoctorDashboard {
  return {
    today: '2026-10-13',
    queueToday: { waiting: 2, inConsultation: 1, done: 4, scheduled: 3, total: 10 },
    nextPatient: {
      appointmentId: 'apt2',
      appointmentNumber: 'APT-2026-000101',
      tokenNumber: 7,
      priority: 'normal',
      startAt: '2026-10-13T05:30:00.000Z',
      patientName: 'Meera Joshi',
    },
    unsignedDrafts: {
      count: 2,
      olderThan24h: 1,
      documentationWindowHours: 72,
      items: [
        {
          encounterId: 'e1',
          appointmentId: 'apt3',
          patientName: 'Old Draft Patient',
          createdAt: '2026-10-11T05:00:00.000Z',
          olderThan24h: true,
        },
        {
          encounterId: 'e2',
          appointmentId: 'apt4',
          patientName: 'Fresh Draft Patient',
          createdAt: '2026-10-13T04:00:00.000Z',
          olderThan24h: false,
        },
      ],
    },
    resultsToReview: {
      count: 2,
      critical: 1,
      items: [
        {
          id: 'lo1',
          orderNumber: 'LAB-2026-000010',
          status: 'released',
          hasCritical: true,
          orderedAt: '2026-10-12T05:00:00.000Z',
          patientName: 'Critical Patient',
        },
        {
          id: 'lo2',
          orderNumber: 'LAB-2026-000011',
          status: 'released',
          hasCritical: false,
          orderedAt: '2026-10-12T06:00:00.000Z',
          patientName: 'Normal Patient',
        },
      ],
    },
    openFollowups: 1,
    weekAppointments: {
      from: '2026-10-12',
      to: '2026-10-18',
      total: 14,
      byStatus: counts({ scheduled: 8, completed: 5, no_show: 1 }),
    },
    ...over,
  };
}

export function labDashboard(over: Partial<LabDashboard> = {}): LabDashboard {
  return {
    today: '2026-10-13',
    countsByStatus: {
      ordered: 5,
      sample_collected: 3,
      sample_rejected: 1,
      processing: 2,
      result_entered: 4,
      verified: 1,
    },
    openTotal: 16,
    urgentPending: 2,
    overdueTat: 1,
    collectedToday: 9,
    releasedToday: 6,
    pendingVerificationByOthers: 3,
    ...over,
  };
}

export function patientDashboard(over: Partial<PatientDashboard> = {}): PatientDashboard {
  return {
    today: '2026-10-13',
    nextAppointment: null,
    activePrescriptions: { count: 0, items: [] },
    newReports: { count: 0, sinceDays: 30, items: [] },
    outstanding: { invoices: 0, balancePaise: 0 },
    followUpsDue: [],
    quickActions: [
      { key: 'book_appointment', link: '/patient/appointments/book' },
      { key: 'request_follow_up', link: '/patient/follow-ups/new' },
    ],
    ...over,
  };
}

export function notification(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    type: 'appointment.booked',
    priority: 'normal',
    title: 'Appointment booked',
    body: 'Appointment APT-2026-000100 is booked.',
    link: '/patient/appointments',
    data: {},
    readAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}
