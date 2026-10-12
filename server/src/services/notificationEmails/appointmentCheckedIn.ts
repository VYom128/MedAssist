import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** appointment.checked_in (in-app by default). */
export const appointmentCheckedIn: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'You are checked in',
    lines: ['You are checked in. Log in to see your place in the queue.'],
  });
