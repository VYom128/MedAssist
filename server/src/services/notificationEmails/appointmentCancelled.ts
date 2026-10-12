import { field, simpleEmail, when, type NotificationEmailTemplate } from './layout.js';

/** appointment.cancelled – the number and time only (never the reason). */
export const appointmentCancelled: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Appointment cancelled',
    lines: [`Your appointment ${field(c, 'appointmentNumber')} on ${when(c)} has been cancelled.`],
  });
