import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** lab.tat_overdue (in-app by default). */
export const labTatOverdue: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Lab order overdue',
    lines: [`Lab order ${field(c, 'orderNumber')} is past its turnaround time. Log in to view it.`],
  });
