import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** followup.request_new (in-app by default) – the number only, never the message. */
export const followupRequestNew: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'New follow-up request',
    lines: [`Follow-up request ${field(c, 'requestNumber')} is waiting. Log in to read it.`],
  });
