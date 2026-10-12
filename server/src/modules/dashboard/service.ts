import { Types } from 'mongoose';
import {
  ENCOUNTER_RULES,
  FOLLOWUP_OPEN_STATUSES,
  LAB_REVIEWABLE_STATUSES,
} from '../../config/constants.js';
import { config } from '../../config/env.js';
import { callsToday } from '../../ai/guards.js';
import { PLACED_LAB_ORDER } from '../../policies/patientAccess.js';
import type { AuthUser } from '../../types/express.js';
import { addDaysToDate, clinicToday, weekdayOf } from '../../utils/dates.js';
import type { RequestMeta } from '../../utils/requestContext.js';
import { Appointment } from '../appointments/model.js';
import { AuditLog } from '../audit/model.js';
import { listFollowUpsDue } from '../encounters/patient.service.js';
import { Encounter } from '../encounters/model.js';
import { FollowupRequest } from '../followups/model.js';
import { Invoice } from '../invoices/model.js';
import { LabOrder } from '../labOrders/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { Prescription } from '../prescriptions/model.js';
import { myPosition } from '../queue/service.js';
import { orderQueue } from '../queue/ordering.js';
import {
  aiUsage,
  appointmentsByStatus,
  appointmentsGrouped,
  clinicRange,
  collectedNet,
  collectedRevenue,
  datesIn,
  doctorUtilisation,
  labTurnaround,
  newPatients,
  noShowRate,
  outstanding,
  type ClinicRange,
} from '../reports/metrics/index.js';
import { getSettings } from '../settings/service.js';

/**
 * Role dashboards (spec §14, §7.18, Phase 10): one call per role returns every widget as plain
 * numbers and arrays (money in paise, instants in UTC, no formatting). Numbers come from the
 * shared metrics module, so they equal the matching report totals for the same range. Doctor
 * and patient dashboards only ever count the caller's own records.
 */

const HOUR = 3_600_000;
type Id = Types.ObjectId;
interface Named {
  _id: Id;
  firstName?: string | null;
  lastName?: string | null;
}
const nameOf = (p?: Named | null) => (p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : null);

/** Today, this month so far, the same days of last month, and the last 30 days (clinic dates). */
export function dashboardRanges(timezone: string, now = new Date()) {
  const today = clinicToday(timezone, now);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthStart = `${addDaysToDate(monthStart, -1).slice(0, 8)}01`;
  const lastMonthEnd = addDaysToDate(monthStart, -1);
  const dayOfMonth = Number(today.slice(8, 10));
  const lastMonthSameDay = addDaysToDate(lastMonthStart, dayOfMonth - 1);
  const weekStart = addDaysToDate(today, -((weekdayOf(today) + 6) % 7)); // Monday
  const r = (from: string, to: string) => clinicRange(from, to, timezone);
  return {
    today,
    todayRange: r(today, today),
    month: r(monthStart, today),
    lastMonth: r(lastMonthStart, lastMonthEnd),
    lastMonthToDate: r(
      lastMonthStart,
      lastMonthSameDay < lastMonthEnd ? lastMonthSameDay : lastMonthEnd,
    ),
    last30: r(addDaysToDate(today, -29), today),
    week: r(weekStart, addDaysToDate(weekStart, 6)),
  };
}

const rangeView = (x: ClinicRange) => ({ from: x.from, to: x.to });

// ---- Admin -----------------------------------------------------------------------------------

export async function adminDashboard(now = new Date()) {
  const { timezone } = await getSettings();
  const R = dashboardRanges(timezone, now);
  const [
    appointmentsToday,
    collectedToday,
    collectedMonth,
    collectedLastMonth,
    collectedLastMonthToDate,
    trend,
    patientsThisMonth,
    noShows,
    utilisation,
    labTat,
    owed,
    alerts,
    ai,
    aiToday,
  ] = await Promise.all([
    appointmentsByStatus(R.todayRange),
    collectedNet(R.todayRange),
    collectedNet(R.month),
    collectedNet(R.lastMonth),
    collectedNet(R.lastMonthToDate),
    collectedRevenue(R.last30, 'day'),
    newPatients(R.month),
    noShowRate(R.last30, {}, now),
    doctorUtilisation(R.last30),
    labTurnaround(R.last30),
    outstanding(),
    AuditLog.find({ outcome: 'denied' })
      .sort({ at: -1, _id: -1 })
      .limit(10)
      .select('at action actor.role actor.name resource.type resource.number')
      .lean(),
    aiUsage(R.last30),
    callsToday(now),
  ]);
  const byDay = new Map(trend.map((t) => [t.key, t]));
  return {
    ranges: {
      today: R.today,
      month: rangeView(R.month),
      lastMonth: rangeView(R.lastMonth),
      last30Days: rangeView(R.last30),
    },
    appointmentsToday,
    revenue: {
      todayPaise: collectedToday,
      thisMonthPaise: collectedMonth,
      lastMonthPaise: collectedLastMonth,
      lastMonthToDatePaise: collectedLastMonthToDate,
      outstandingPaise: owed.balancePaise,
      outstandingInvoices: owed.invoices,
    },
    revenueTrend: datesIn(R.last30.from, R.last30.to).map((date) => ({
      date,
      netPaise: byDay.get(date)?.netPaise ?? 0,
    })),
    newPatientsThisMonth: patientsThisMonth,
    noShowRate30d: noShows,
    doctorUtilisation: utilisation,
    labTurnaround: labTat.overall,
    auditAlerts: alerts.map((a) => ({
      id: a._id.toString(),
      at: a.at,
      action: a.action,
      actorRole: a.actor?.role ?? null,
      actorName: a.actor?.name ?? null,
      resourceType: a.resource?.type ?? null,
      resourceNumber: a.resource?.number ?? null,
    })),
    ai: { ...ai, today: { calls: aiToday, limit: config.ai.dailyCallLimit } },
  };
}

// ---- Reception -------------------------------------------------------------------------------

export async function receptionDashboard(now = new Date()) {
  const { timezone } = await getSettings();
  const R = dashboardRanges(timezone, now);
  const today = { startAt: { $gte: R.todayRange.start, $lt: R.todayRange.end } };
  const unpaidFilter = {
    status: { $in: ['issued', 'partially_paid'] },
    issuedAt: { $gte: R.todayRange.start, $lt: R.todayRange.end },
    balancePaise: { $gt: 0 },
  };
  const [byDoctor, waiting, unpaidCount, unpaid, openFollowups, upcoming] = await Promise.all([
    appointmentsGrouped(R.todayRange, 'doctor'),
    Appointment.countDocuments({ ...today, status: 'checked_in' }),
    Invoice.countDocuments(unpaidFilter),
    Invoice.find(unpaidFilter)
      .sort({ issuedAt: -1, _id: -1 })
      .limit(5)
      .populate({ path: 'patient', select: 'firstName lastName' })
      .select('invoiceNumber status balancePaise issuedAt patient')
      .lean<
        {
          _id: Id;
          invoiceNumber?: string;
          status: string;
          balancePaise: number;
          issuedAt?: Date;
          patient?: Named;
        }[]
      >(),
    FollowupRequest.countDocuments({ status: { $in: FOLLOWUP_OPEN_STATUSES } }),
    Appointment.find({
      status: 'scheduled',
      startAt: { $gte: now, $lt: new Date(now.getTime() + 2 * HOUR) },
    })
      .sort({ startAt: 1, _id: 1 })
      .limit(10)
      .populate([
        { path: 'patient', select: 'firstName lastName' },
        { path: 'doctor', select: 'firstName lastName' },
      ])
      .select('appointmentNumber startAt status patient doctor')
      .lean<
        {
          _id: Id;
          appointmentNumber: string;
          startAt: Date;
          status: string;
          patient?: Named;
          doctor?: Named;
        }[]
      >(),
  ]);
  return {
    today: R.today,
    appointmentsByDoctor: byDoctor.map((x) => ({
      doctorId: x.key,
      doctorName: x.label,
      total: x.total,
      scheduled: x.scheduled,
      checkedIn: x.checked_in,
      inConsultation: x.in_consultation,
      completed: x.completed,
      cancelled: x.cancelled,
      noShow: x.no_show,
    })),
    checkInsWaiting: waiting,
    unpaidToday: {
      count: unpaidCount,
      items: unpaid.map((i) => ({
        id: i._id.toString(),
        invoiceNumber: i.invoiceNumber ?? null,
        status: i.status,
        balancePaise: i.balancePaise,
        issuedAt: i.issuedAt ?? null,
        patientName: nameOf(i.patient),
      })),
    },
    openFollowups,
    upcoming: upcoming.map((a) => ({
      id: a._id.toString(),
      appointmentNumber: a.appointmentNumber,
      startAt: a.startAt,
      status: a.status,
      patientName: nameOf(a.patient),
      doctorName: a.doctor ? `Dr ${nameOf(a.doctor)}` : null,
    })),
  };
}

// ---- Doctor (own records only) ----------------------------------------------------------------

export async function doctorDashboard(user: AuthUser, now = new Date()) {
  const { timezone } = await getSettings();
  const R = dashboardRanges(timezone, now);
  const me = new Types.ObjectId(user.id);
  const todayMatch = {
    doctor: me,
    startAt: { $gte: R.todayRange.start, $lt: R.todayRange.end },
  };
  const reviewFilter = {
    orderedBy: me,
    reviewedByDoctorAt: null,
    $or: [
      { status: { $in: LAB_REVIEWABLE_STATUSES } },
      { hasCritical: true, status: { $nin: ['draft', 'cancelled'] } },
    ],
  };
  const draftCutoff = new Date(now.getTime() - 24 * HOUR);
  const [
    todayCounts,
    waiting,
    drafts,
    draftCount,
    overdueDrafts,
    toReview,
    reviewCount,
    criticalCount,
    followups,
    week,
  ] = await Promise.all([
    appointmentsByStatus(R.todayRange, { doctorId: user.id }),
    Appointment.find({ ...todayMatch, status: 'checked_in' })
      .populate({ path: 'patient', select: 'firstName lastName' })
      .select('appointmentNumber status type priority isOverbook startAt queue patient')
      .lean(),
    Encounter.find({ doctor: me, status: 'draft' })
      .sort({ createdAt: 1, _id: 1 })
      .limit(5)
      .populate({ path: 'patient', select: 'firstName lastName' })
      .select('encounterNumber appointment createdAt patient')
      .lean<
        { _id: Id; encounterNumber?: string; appointment: Id; createdAt: Date; patient?: Named }[]
      >(),
    Encounter.countDocuments({ doctor: me, status: 'draft' }),
    Encounter.countDocuments({ doctor: me, status: 'draft', createdAt: { $lt: draftCutoff } }),
    LabOrder.find(reviewFilter)
      .sort({ hasCritical: -1, releasedAt: 1, orderedAt: 1, _id: 1 })
      .limit(5)
      .populate({ path: 'patient', select: 'firstName lastName' })
      .select('orderNumber status hasCritical orderedAt releasedAt patient')
      .lean<
        {
          _id: Id;
          orderNumber?: string;
          status: string;
          hasCritical?: boolean;
          orderedAt?: Date;
          patient?: Named;
        }[]
      >(),
    LabOrder.countDocuments(reviewFilter),
    LabOrder.countDocuments({ ...reviewFilter, hasCritical: true }),
    FollowupRequest.countDocuments({ assignedDoctor: me, status: { $in: FOLLOWUP_OPEN_STATUSES } }),
    appointmentsByStatus(R.week, { doctorId: user.id }),
  ]);
  const next = orderQueue(waiting)[0] as
    ((typeof waiting)[number] & { patient?: Named }) | undefined;
  return {
    today: R.today,
    queueToday: {
      waiting: todayCounts.checked_in,
      inConsultation: todayCounts.in_consultation,
      done: todayCounts.completed,
      scheduled: todayCounts.scheduled,
      total: todayCounts.total,
    },
    nextPatient: next
      ? {
          appointmentId: next._id.toString(),
          appointmentNumber: next.appointmentNumber,
          tokenNumber: next.queue?.tokenNumber ?? null,
          priority: next.priority ?? 'normal',
          startAt: next.startAt,
          patientName: nameOf(next.patient as Named | undefined),
        }
      : null,
    unsignedDrafts: {
      count: draftCount,
      olderThan24h: overdueDrafts,
      documentationWindowHours: ENCOUNTER_RULES.documentationWindowHours,
      items: drafts.map((e) => ({
        encounterId: e._id.toString(),
        appointmentId: e.appointment.toString(),
        patientName: nameOf(e.patient),
        createdAt: e.createdAt,
        olderThan24h: e.createdAt < draftCutoff,
      })),
    },
    resultsToReview: {
      count: reviewCount,
      critical: criticalCount,
      items: toReview.map((o) => ({
        id: o._id.toString(),
        orderNumber: o.orderNumber ?? null,
        status: o.status,
        hasCritical: Boolean(o.hasCritical),
        orderedAt: o.orderedAt ?? null,
        patientName: nameOf(o.patient),
      })),
    },
    openFollowups: followups,
    weekAppointments: {
      from: R.week.from,
      to: R.week.to,
      total: week.total - week.cancelled,
      byStatus: week,
    },
  };
}

// ---- Lab -------------------------------------------------------------------------------------

const LAB_OPEN = [
  'ordered',
  'sample_collected',
  'sample_rejected',
  'processing',
  'result_entered',
  'verified',
] as const;

export async function labDashboard(user: AuthUser, now = new Date()) {
  const { timezone } = await getSettings();
  const R = dashboardRanges(timezone, now);
  const me = new Types.ObjectId(user.id);
  const open = { ...PLACED_LAB_ORDER, status: { $in: LAB_OPEN } };
  const [byStatus, urgent, overdue, collected, releasedToday, toVerify] = await Promise.all([
    LabOrder.aggregate<{ _id: string; n: number }>([
      { $match: open },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    LabOrder.countDocuments({ ...open, priority: 'urgent' }),
    LabOrder.countDocuments({ ...open, tatBreachedAt: { $type: 'date' } }),
    LabOrder.countDocuments({
      'sample.collectedAt': { $gte: R.todayRange.start, $lt: R.todayRange.end },
    }),
    LabOrder.countDocuments({ releasedAt: { $gte: R.todayRange.start, $lt: R.todayRange.end } }),
    // Results someone else entered, waiting for a second technician (dual verification).
    LabOrder.countDocuments({
      ...PLACED_LAB_ORDER,
      status: 'result_entered',
      items: { $elemMatch: { status: 'result_entered', enteredBy: { $ne: me } } },
    }),
  ]);
  const counts = Object.fromEntries(LAB_OPEN.map((s) => [s, 0])) as Record<
    (typeof LAB_OPEN)[number],
    number
  >;
  for (const row of byStatus) counts[row._id as (typeof LAB_OPEN)[number]] = row.n;
  return {
    today: R.today,
    countsByStatus: counts,
    openTotal: byStatus.reduce((s, x) => s + x.n, 0),
    urgentPending: urgent,
    overdueTat: overdue,
    collectedToday: collected,
    releasedToday,
    pendingVerificationByOthers: toVerify,
  };
}

// ---- Patient (own records only) ---------------------------------------------------------------

export async function patientDashboard(user: AuthUser, meta: RequestMeta, now = new Date()) {
  const patientId = await resolveMyPatientId(user); // 403 while the link is pending
  const pid = new Types.ObjectId(patientId);
  const { timezone } = await getSettings();
  const R = dashboardRanges(timezone, now);
  const [next, position, activeCount, active, reportsCount, reports, balance, followUpsDue] =
    await Promise.all([
      Appointment.findOne({
        patient: pid,
        status: { $in: ['scheduled', 'checked_in', 'in_consultation'] },
        startAt: { $gte: R.todayRange.start },
      })
        .sort({ startAt: 1, _id: 1 })
        .populate([
          { path: 'doctor', select: 'firstName lastName' },
          { path: 'department', select: 'name' },
        ])
        .select('appointmentNumber startAt status doctor department')
        .lean<{
          _id: Id;
          appointmentNumber: string;
          startAt: Date;
          status: string;
          doctor?: Named;
          department?: { name?: string } | null;
        }>(),
      myPosition(user),
      Prescription.countDocuments({ patient: pid, status: 'issued' }),
      Prescription.find({ patient: pid, status: 'issued' })
        .sort({ issuedAt: -1, _id: -1 })
        .limit(3)
        .populate({ path: 'doctor', select: 'firstName lastName' })
        .select('prescriptionNumber issuedAt doctor')
        .lean<{ _id: Id; prescriptionNumber?: string; issuedAt?: Date; doctor?: Named }[]>(),
      LabOrder.countDocuments({
        patient: pid,
        status: 'released',
        releasedAt: { $gte: R.last30.start },
      }),
      LabOrder.find({ patient: pid, status: 'released', releasedAt: { $gte: R.last30.start } })
        .sort({ releasedAt: -1, _id: -1 })
        .limit(3)
        .select('orderNumber releasedAt')
        .lean<{ _id: Id; orderNumber?: string; releasedAt?: Date }[]>(),
      Invoice.aggregate<{ invoices: number; balance: number }>([
        { $match: { patient: pid, status: { $in: ['issued', 'partially_paid'] } } },
        { $group: { _id: null, invoices: { $sum: 1 }, balance: { $sum: '$balancePaise' } } },
      ]),
      listFollowUpsDue(user, meta, now),
    ]);
  return {
    today: R.today,
    nextAppointment: next
      ? {
          id: next._id.toString(),
          appointmentNumber: next.appointmentNumber,
          startAt: next.startAt,
          status: next.status,
          doctorName: next.doctor ? `Dr ${nameOf(next.doctor)}` : null,
          department: next.department?.name ?? null,
          queue:
            position && position.appointmentId === next._id.toString()
              ? {
                  tokenNumber: position.tokenNumber,
                  position: position.position,
                  patientsAhead: position.patientsAhead,
                  estimatedWaitMinutes: position.estimatedWaitMinutes,
                }
              : null,
        }
      : null,
    activePrescriptions: {
      count: activeCount,
      items: active.map((p) => ({
        id: p._id.toString(),
        prescriptionNumber: p.prescriptionNumber ?? null,
        issuedAt: p.issuedAt ?? null,
        doctorName: p.doctor ? `Dr ${nameOf(p.doctor)}` : null,
      })),
    },
    newReports: {
      count: reportsCount,
      sinceDays: 30,
      items: reports.map((o) => ({
        id: o._id.toString(),
        orderNumber: o.orderNumber ?? null,
        releasedAt: o.releasedAt ?? null,
      })),
    },
    outstanding: {
      invoices: balance[0]?.invoices ?? 0,
      balancePaise: balance[0]?.balance ?? 0,
    },
    followUpsDue,
    quickActions: [
      { key: 'book_appointment', link: '/patient/appointments/book' },
      { key: 'request_follow_up', link: '/patient/follow-ups/new' },
    ],
  };
}
