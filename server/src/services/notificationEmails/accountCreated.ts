import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** account.created – the "set your password" link (valid 72 hours); email only, never stored. */
export const accountCreated: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Your MedAssist account',
    lines: [
      'An account has been created for you on MedAssist.',
      'Set your password with the link below. It expires in 72 hours.',
    ],
    button: 'Set your password',
  });
