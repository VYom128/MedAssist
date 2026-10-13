import { field, simpleEmail, when, type NotificationEmailTemplate } from './layout.js';

/** appointment.rescheduled – the number and the new time only. */
export const appointmentRescheduled: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Appointment rescheduled',
    lines: [`Your appointment ${field(c, 'appointmentNumber')} has been moved to ${when(c)}.`],
  });
