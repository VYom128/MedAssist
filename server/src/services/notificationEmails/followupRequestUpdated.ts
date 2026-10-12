import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** followup.request_updated (in-app by default). */
export const followupRequestUpdated: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Update on your request',
    lines: [`There is an update on your request ${field(c, 'requestNumber')}. Log in to read it.`],
  });
