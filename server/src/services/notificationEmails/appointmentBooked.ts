import { field, simpleEmail, when, type NotificationEmailTemplate } from './layout.js';

/** appointment.booked – the number and time only (no doctor, department or reason). */
export const appointmentBooked: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Appointment confirmed',
    lines: [`Your appointment ${field(c, 'appointmentNumber')} on ${when(c)} is confirmed.`],
  });
