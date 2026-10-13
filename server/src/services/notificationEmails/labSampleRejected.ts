import { simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** lab.sample_rejected – patients and reception; never the test or the reason. */
export const labSampleRejected: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'A new lab sample is needed',
    lines: ['A lab sample needs to be collected again. Please log in or contact the clinic.'],
  });
