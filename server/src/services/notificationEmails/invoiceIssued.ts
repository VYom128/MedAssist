import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** invoice.issued – the invoice number only, never amounts or lines. */
export const invoiceIssued: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Your invoice is ready',
    lines: [`Your invoice ${field(c, 'invoiceNumber')} is ready. Log in to view it.`],
  });
