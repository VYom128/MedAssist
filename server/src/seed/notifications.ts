import type { Types } from 'mongoose';
import {
  FOLLOWUP_OPEN_STATUSES,
  NOTIFICATION_TYPES,
  ROLES,
  type NotificationType,
} from '../config/constants.js';
import { runLabTatJob } from '../jobs/labTat.job.js';
import { Appointment } from '../modules/appointments/model.js';
import { FollowupRequest } from '../modules/followups/model.js';
import { Invoice } from '../modules/invoices/model.js';
import { LabOrder } from '../modules/labOrders/model.js';
import { Notification } from '../modules/notifications/model.js';
import { Prescription } from '../modules/prescriptions/model.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import {
  notificationLink,
  notify,
  setNotificationEmailsMuted,
  setNotificationsMuted,
} from '../services/notification.service.js';
import { formatClinicDateTime } from '../utils/dates.js';

/**
 * Demo notifications (Phase 10, spec §15.3): every demo login except the admin (no §11 event goes
 * to admins until break-glass exists) starts with a few unread notifications about its own seeded
 * records – the same titles, bodies, links and data the real triggers use – stored in-app only
 * (no email). Lab technicians get theirs from the real TAT job. Dedupe keys start with `seed:`,
 * so re-running the seed creates nothing and the real events (reminders, releases) still fire
 * later.
 */

type Id = Types.ObjectId;

async function seedNote(
  type: NotificationType,
  userId: Id,
  title: string,
  body: string,
  link: string | undefined,
  data: Record<string, unknown>,
  key: string,
) {
  await notify({
    recipients: [{ userId: userId.toString() }],
    type,
    title,
    body,
    link,
    data,
    email: false,
    dedupeKey: `seed:${type}:${key}`,
  });
}

async function forPatients(timezone: string, now: Date) {
  const users = await User.find({
    role: ROLES.PATIENT,
    isActive: true,
    patient: { $ne: null },
    patientLinkStatus: { $ne: 'pending_verification' },
  })
    .select('patient')
    .lean();
  for (const u of users) {
    const patient = u.patient as Id;
    const [next, report, invoice, rx] = await Promise.all([
      Appointment.findOne({ patient, status: 'scheduled', startAt: { $gt: now } })
        .sort({ startAt: 1 })
        .select('appointmentNumber startAt status')
        .lean(),
      LabOrder.findOne({ patient, status: 'released' })
        .sort({ releasedAt: -1 })
        .select('_id')
        .lean(),
      Invoice.findOne({ patient, status: { $in: ['issued', 'partially_paid'] } })
        .sort({ issuedAt: -1 })
        .select('invoiceNumber')
        .lean(),
      Prescription.findOne({ patient, status: 'issued' })
        .sort({ issuedAt: -1 })
        .select('_id')
        .lean(),
    ]);
    if (next) {
      const type = NOTIFICATION_TYPES.APPOINTMENT_REMINDER;
      await seedNote(
        type,
        u._id,
        'Appointment reminder',
        `Reminder: your appointment ${next.appointmentNumber} is on ${formatClinicDateTime(next.startAt, timezone)}.`,
        notificationLink(type, ROLES.PATIENT),
        {
          appointmentId: next._id.toString(),
          appointmentNumber: next.appointmentNumber,
          startAt: next.startAt.toISOString(),
          status: next.status,
        },
        next._id.toString(),
      );
    }
    if (report) {
      const type = NOTIFICATION_TYPES.LAB_RESULT_RELEASED;
      await seedNote(
        type,
        u._id,
        'New lab report',
        'A new lab report is available – please log in to view it.',
        notificationLink(type, ROLES.PATIENT, report._id),
        { labOrderId: report._id.toString() },
        report._id.toString(),
      );
    }
    if (invoice) {
      const type = NOTIFICATION_TYPES.INVOICE_ISSUED;
      await seedNote(
        type,
        u._id,
        'Your invoice is ready',
        `Your invoice ${invoice.invoiceNumber ?? ''} is ready. Please log in to view it.`,
        notificationLink(type, ROLES.PATIENT, invoice._id),
        {
          invoiceId: invoice._id.toString(),
          ...(invoice.invoiceNumber ? { invoiceNumber: invoice.invoiceNumber } : {}),
        },
        invoice._id.toString(),
      );
    }
    if (rx) {
      const type = NOTIFICATION_TYPES.PRESCRIPTION_ISSUED;
      await seedNote(
        type,
        u._id,
        'New prescription',
        'Your doctor has issued a prescription. Log in to view it.',
        notificationLink(type, ROLES.PATIENT, rx._id),
        { prescriptionId: rx._id.toString() },
        rx._id.toString(),
      );
    }
  }
}

async function forDoctors(timezone: string, now: Date) {
  const doctors = await User.find({ role: ROLES.DOCTOR, isActive: true }).select('_id').lean();
  for (const d of doctors) {
    const [next, toReview, critical, followups] = await Promise.all([
      Appointment.findOne({ doctor: d._id, status: 'scheduled', startAt: { $gt: now } })
        .sort({ startAt: 1 })
        .select('appointmentNumber startAt status')
        .lean(),
      LabOrder.find({ orderedBy: d._id, status: 'released', reviewedByDoctorAt: null })
        .sort({ releasedAt: -1 })
        .limit(2)
        .select('_id')
        .lean(),
      LabOrder.find({
        orderedBy: d._id,
        hasCritical: true,
        reviewedByDoctorAt: null,
        status: { $nin: ['draft', 'cancelled'] },
      })
        .limit(1)
        .select('_id')
        .lean(),
      FollowupRequest.find({ assignedDoctor: d._id, status: { $in: FOLLOWUP_OPEN_STATUSES } })
        .sort({ createdAt: -1 })
        .limit(2)
        .select('requestNumber')
        .lean(),
    ]);
    if (next) {
      const type = NOTIFICATION_TYPES.APPOINTMENT_BOOKED;
      const when = formatClinicDateTime(next.startAt, timezone);
      await seedNote(
        type,
        d._id,
        'Appointment booked',
        `Appointment ${next.appointmentNumber} on ${when} was booked.`,
        notificationLink(type, ROLES.DOCTOR, next._id),
        {
          appointmentId: next._id.toString(),
          appointmentNumber: next.appointmentNumber,
          startAt: next.startAt.toISOString(),
          status: next.status,
        },
        `${next._id.toString()}:doctor`,
      );
    }
    for (const o of toReview) {
      const type = NOTIFICATION_TYPES.LAB_RESULT_RELEASED;
      await seedNote(
        type,
        d._id,
        'Lab results ready',
        'Lab results of one of your patients are ready – please log in to review them.',
        notificationLink(type, ROLES.DOCTOR, o._id),
        { labOrderId: o._id.toString() },
        `${o._id.toString()}:doctor`,
      );
    }
    for (const o of critical) {
      const type = NOTIFICATION_TYPES.LAB_CRITICAL_VALUE;
      await seedNote(
        type,
        d._id,
        'Critical lab result',
        'A critical lab result needs your attention – please log in.',
        notificationLink(type, ROLES.DOCTOR, o._id),
        { labOrderId: o._id.toString() },
        o._id.toString(),
      );
    }
    for (const r of followups) {
      const type = NOTIFICATION_TYPES.FOLLOWUP_REQUEST_NEW;
      await seedNote(
        type,
        d._id,
        'New follow-up request',
        `Follow-up request ${r.requestNumber} is waiting. Please log in to read it.`,
        notificationLink(type, ROLES.DOCTOR, r._id),
        { requestId: r._id.toString(), requestNumber: r.requestNumber },
        `${r._id.toString()}:doctor`,
      );
    }
  }
}

async function forReception() {
  const [desk, followups, rejected] = await Promise.all([
    User.find({ role: ROLES.RECEPTIONIST, isActive: true }).select('_id').lean(),
    FollowupRequest.find({ status: { $in: FOLLOWUP_OPEN_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(2)
      .select('requestNumber')
      .lean(),
    LabOrder.find({ status: 'sample_rejected' }).limit(2).select('patient').lean(),
  ]);
  for (const u of desk) {
    for (const r of followups) {
      const type = NOTIFICATION_TYPES.FOLLOWUP_REQUEST_NEW;
      await seedNote(
        type,
        u._id,
        'New follow-up request',
        `Follow-up request ${r.requestNumber} is waiting. Please log in to read it.`,
        notificationLink(type, ROLES.RECEPTIONIST, r._id),
        { requestId: r._id.toString(), requestNumber: r.requestNumber },
        `${r._id.toString()}:${u._id.toString()}`,
      );
    }
    for (const o of rejected) {
      const type = NOTIFICATION_TYPES.LAB_SAMPLE_REJECTED;
      await seedNote(
        type,
        u._id,
        'A patient needs a new lab sample',
        'A lab sample was rejected. Please arrange for the patient to return.',
        notificationLink(type, ROLES.RECEPTIONIST, o.patient as Id),
        { labOrderId: o._id.toString(), patientId: (o.patient as Id).toString() },
        `${o._id.toString()}:${u._id.toString()}`,
      );
    }
  }
}

export async function seedNotifications(): Promise<Record<string, number>> {
  const before = await Notification.countDocuments();
  const { timezone } = await getSettings();
  const now = new Date();
  setNotificationsMuted(false);
  setNotificationEmailsMuted(true);
  try {
    await forPatients(timezone, now);
    await forDoctors(timezone, now);
    await forReception();
    // Lab technicians: the real hourly job marks overdue orders and alerts them (once per order).
    await runLabTatJob(now);
  } finally {
    setNotificationEmailsMuted(false);
    setNotificationsMuted(true);
  }
  const after = await Notification.countDocuments();
  return {
    created: after - before,
    unchanged: before,
    unread: await Notification.countDocuments({ readAt: null }),
  };
}
