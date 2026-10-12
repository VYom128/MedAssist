import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** payment.received – the invoice number only, never the amount. */
export const paymentReceived: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Payment received',
    lines: [
      `We have received a payment for invoice ${field(c, 'invoiceNumber')}.`,
      'Your receipt is available – log in to view it.',
    ],
  });
