import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** account.password_reset – the reset link (valid 30 minutes); email only, never stored. */
export const accountPasswordReset: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Reset your MedAssist password',
    lines: [
      'We received a request to reset your MedAssist password.',
      'The link expires in 30 minutes. If you did not ask for this, you can ignore this email.',
    ],
    button: 'Reset password',
  });
