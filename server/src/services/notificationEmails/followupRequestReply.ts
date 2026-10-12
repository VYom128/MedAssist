import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** followup.request_reply (in-app by default). */
export const followupRequestReply: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'New reply on a follow-up request',
    lines: [`There is a new reply on ${field(c, 'requestNumber')}. Log in to read it.`],
  });
