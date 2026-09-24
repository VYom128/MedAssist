import { JOB_RULES, NOTIFICATION_TYPES } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import { loadAppointment, notifyAppointment } from '../modules/appointments/service.js';
import { getSettings } from '../modules/settings/service.js';
import { logger, serializeError } from '../utils/logger.js';

const MINUTE = 60_000;

export interface ReminderJobResult {
  sent: number;
  failed: number;
}

/**
 * Appointment reminders (spec §8.11): scheduled appointments starting `reminderHoursBefore` from
 * `now`, give or take the 15-minute run interval, that have no `reminderSentAt` yet. Each one is
 * claimed by setting `reminderSentAt` with a conditional update before the patient is notified,
 * so a reminder is never sent twice, even by overlapping runs. (A reschedule clears it.)
 */
export async function runReminderJob(now = new Date()): Promise<ReminderJobResult> {
  const settings = await getSettings();
  const lead = settings.appointment!.reminderHoursBefore * 60 * MINUTE;
  const window = JOB_RULES.reminderWindowMinutes * MINUTE;
  const due = await Appointment.find({
    status: 'scheduled',
    reminderSentAt: null,
    startAt: {
      $gt: now,
      $gte: new Date(now.getTime() + lead - window),
      $lte: new Date(now.getTime() + lead + window),
    },
  })
    .select('_id')
    .sort({ startAt: 1 })
    .limit(JOB_RULES.batchSize)
    .lean();

  const result: ReminderJobResult = { sent: 0, failed: 0 };
  for (const { _id } of due) {
    try {
      const claimed = await Appointment.updateOne(
        { _id, status: 'scheduled', reminderSentAt: null },
        { $set: { reminderSentAt: now } },
      );
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
