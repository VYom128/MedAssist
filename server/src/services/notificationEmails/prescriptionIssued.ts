import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** prescription.issued (in-app by default) – never the medicines. */
export const prescriptionIssued: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'New prescription',
    lines: ['You have a new prescription. Log in to view it.'],
  });
