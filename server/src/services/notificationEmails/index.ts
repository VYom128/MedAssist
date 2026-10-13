import type { NotificationType } from '../../config/constants.js';
import { accountCreated } from './accountCreated.js';
import { accountPasswordReset } from './accountPasswordReset.js';
import { appointmentBooked } from './appointmentBooked.js';
import { appointmentCancelled } from './appointmentCancelled.js';
import { appointmentCheckedIn } from './appointmentCheckedIn.js';
import { appointmentNoShow } from './appointmentNoShow.js';
import { appointmentReminder } from './appointmentReminder.js';
import { appointmentRescheduled } from './appointmentRescheduled.js';
import { followupReminder } from './followupReminder.js';
import { followupRequestNew } from './followupRequestNew.js';
import { followupRequestReply } from './followupRequestReply.js';
import { followupRequestUpdated } from './followupRequestUpdated.js';
import { invoiceIssued } from './invoiceIssued.js';
import { labCriticalValue } from './labCriticalValue.js';
import { labResultReleased } from './labResultReleased.js';
import { labResultRevised } from './labResultRevised.js';
import { labSampleRejected } from './labSampleRejected.js';
import { labTatOverdue } from './labTatOverdue.js';
import type { NotificationEmailTemplate } from './layout.js';
import { leaveAffectsAppointments } from './leaveAffectsAppointments.js';
import { paymentReceived } from './paymentReceived.js';
import { prescriptionIssued } from './prescriptionIssued.js';
import { queueYourTurn } from './queueYourTurn.js';

/** The email template of every notification type (one file each). */
export const NOTIFICATION_EMAILS: Readonly<Record<NotificationType, NotificationEmailTemplate>> =
  Object.freeze({
    'appointment.booked': appointmentBooked,
    'appointment.rescheduled': appointmentRescheduled,
    'appointment.cancelled': appointmentCancelled,
    'appointment.no_show': appointmentNoShow,
    'appointment.reminder': appointmentReminder,
    'appointment.checked_in': appointmentCheckedIn,
    'queue.your_turn': queueYourTurn,
    'doctor.leave_affects_appointments': leaveAffectsAppointments,
    'prescription.issued': prescriptionIssued,
    'lab.sample_rejected': labSampleRejected,
    'lab.critical_value': labCriticalValue,
    'lab.result_released': labResultReleased,
    'lab.result_revised': labResultRevised,
    'lab.tat_overdue': labTatOverdue,
    'invoice.issued': invoiceIssued,
    'payment.received': paymentReceived,
    'followup.reminder': followupReminder,
    'followup.request_new': followupRequestNew,
    'followup.request_reply': followupRequestReply,
    'followup.request_updated': followupRequestUpdated,
    'account.created': accountCreated,
    'account.password_reset': accountPasswordReset,
  });

export type { NotificationEmailContext, NotificationEmailTemplate } from './layout.js';
