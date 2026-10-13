import { field, simpleEmail, type NotificationEmailTemplate } from './layout.js';

/** doctor.leave_affects_appointments (in-app by default) – a count, no names. */
export const leaveAffectsAppointments: NotificationEmailTemplate = (c) =>
  simpleEmail(c, {
    subject: 'Booked appointments need attention',
    lines: [
      `A doctor's leave affects ${field(c, 'count') || 'some'} booked appointments.`,
      'Log in to reschedule or cancel them.',
    ],
  });
