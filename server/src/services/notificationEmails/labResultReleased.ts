import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** lab.result_released – patient and ordering doctor; never tests or values. */
export const labResultReleased: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'New lab report',
    lines: ['You have a new lab report. Log in to view it.'],
  });
