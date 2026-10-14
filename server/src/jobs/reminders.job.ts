import { JOB_RULES, NOTIFICATION_TYPES } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import { loadAppointment, notifyAppointment } from '../modules/appointments/service.js';
import { getSettings } from '../modules/settings/service.js';
import { logger, serializeError } from '../utils/logger.js';

const MINUTE = 60_000;

export interface ReminderJobResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Appointment reminders (spec §8.11, D202): scheduled appointments whose reminder moment
 * (`startAt − reminderHoursBefore`, give or take the 15-minute run interval) has come, with no
 * reminder sent or skipped yet. It catches up after the API slept (Render free tier): a reminder
 * that is late is still sent while the visit is in the future; once the visit has started it is
 * marked skipped instead. Appointments booked after their reminder moment get none (the booking
 * confirmation is enough) – as before. Each one is claimed with a conditional update before the
 * patient is notified, so a reminder is sent at most once, even by overlapping runs. (A
 * reschedule clears both marks.)
 */
export async function runReminderJob(now = new Date()): Promise<ReminderJobResult> {
  const settings = await getSettings();
  const lead = settings.appointment!.reminderHoursBefore * 60 * MINUTE;
  const window = JOB_RULES.reminderWindowMinutes * MINUTE;
  const due = await Appointment.find({
    status: 'scheduled',
    reminderSentAt: null,
    reminderSkippedAt: null,
    startAt: { $lte: new Date(now.getTime() + lead + window) },
    // Booked before the reminder moment (else the confirmation was the reminder).
    $expr: { $lte: ['$createdAt', { $subtract: ['$startAt', lead - window] }] },
  })
    .select('_id startAt')
    .sort({ startAt: 1 })
    .limit(JOB_RULES.batchSize)
    .lean();

  const result: ReminderJobResult = { sent: 0, skipped: 0, failed: 0 };
  for (const { _id, startAt } of due) {
    try {
      const unclaimed = { _id, status: 'scheduled', reminderSentAt: null, reminderSkippedAt: null };
      if (startAt <= now) {
        // Too late to remind: the visit has started (the API was asleep at the reminder time).
        const skipped = await Appointment.updateOne(unclaimed, {
          $set: { reminderSkippedAt: now },
        });
        result.skipped += skipped.modifiedCount;
        continue;
      }
      const claimed = await Appointment.updateOne(unclaimed, { $set: { reminderSentAt: now } });
      if (claimed.modifiedCount === 0) continue; // another run, a cancel or a check-in got there first
      await notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_REMINDER, await loadAppointment(_id));
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      logger.error({ err: serializeError(err), job: 'reminders' }, 'Reminder failed');
    }
  }
  logger.info({ job: 'reminders', due: due.length, ...result }, 'Reminder job finished');
  return result;
}
