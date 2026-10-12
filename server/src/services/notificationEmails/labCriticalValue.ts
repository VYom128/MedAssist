import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** lab.critical_value – the ordering doctor; never the test or the value. */
export const labCriticalValue: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Critical lab result',
    lines: ['A critical lab result needs your attention. Log in to view it.'],
  });
