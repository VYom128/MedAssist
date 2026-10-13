import { day, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** followup.reminder – the due date only (no doctor or reason). */
export const followupReminder: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Time to book your follow-up visit',
    lines: [`Your follow-up visit is due around ${day(c, 'dueDate')}. You can book it online.`],
    button: 'Book the visit',
  });
