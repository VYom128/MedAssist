import { field, simpleEmail, when, type NotificationEmailTemplate } from './layout.js';

/** appointment.reminder */
export const appointmentReminder: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Appointment reminder',
    lines: [`Reminder: your appointment ${field(c, 'appointmentNumber')} is on ${when(c)}.`],
  });
