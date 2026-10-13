/**
 * Notification types (spec §11) – mirrors NOTIFICATION_TYPES / NOTIFICATION_CONFIG in
 * server/src/config/constants.ts (a server test checks both lists match). Labels are what the
 * bell and the notifications page show; `critical` ones are highlighted.
 */
export const NOTIFICATION_TYPES = [
  'appointment.booked',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.no_show',
  'appointment.reminder',
  'appointment.checked_in',
  'queue.your_turn',
  'doctor.leave_affects_appointments',
  'prescription.issued',
  'lab.sample_rejected',
  'lab.critical_value',
  'lab.result_released',
  'lab.result_revised',
  'lab.tat_overdue',
  'invoice.issued',
  'payment.received',
  'followup.reminder',
  'followup.request_new',
  'followup.request_reply',
  'followup.request_updated',
  'account.created',
  'account.password_reset',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  'appointment.booked': 'Appointment booked',
  'appointment.rescheduled': 'Appointment rescheduled',
  'appointment.cancelled': 'Appointment cancelled',
  'appointment.no_show': 'Missed appointment',
  'appointment.reminder': 'Appointment reminder',
  'appointment.checked_in': 'Checked in',
  'queue.your_turn': 'You are next',
  'doctor.leave_affects_appointments': 'Doctor leave',
  'prescription.issued': 'Prescription',
  'lab.sample_rejected': 'New sample needed',
  'lab.critical_value': 'Critical lab result',
  'lab.result_released': 'Lab report',
  'lab.result_revised': 'Updated lab report',
  'lab.tat_overdue': 'Lab order overdue',
  'invoice.issued': 'Invoice',
  'payment.received': 'Payment received',
  'followup.reminder': 'Follow-up due',
  'followup.request_new': 'Follow-up request',
  'followup.request_reply': 'Follow-up reply',
  'followup.request_updated': 'Follow-up update',
  'account.created': 'Account',
  'account.password_reset': 'Password reset',
};

export const NOTIFICATION_PRIORITIES = ['normal', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
