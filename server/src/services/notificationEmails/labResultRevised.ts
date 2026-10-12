import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** lab.result_revised */
export const labResultRevised: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Updated lab report',
    lines: ['An updated lab report is available. Log in to view it.'],
  });
