import { field, simpleEmail, when, type NotificationEmailTemplate } from './layout.js';

/** appointment.no_show */
export const appointmentNoShow: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Missed appointment',
    lines: [
      `We missed you at your appointment ${field(c, 'appointmentNumber')} on ${when(c)}.`,
      'Please contact the clinic or log in to book again.',
    ],
  });
