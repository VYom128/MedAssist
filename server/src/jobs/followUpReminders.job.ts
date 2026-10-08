import { formatInTimeZone } from 'date-fns-tz';
import { FOLLOWUP_RULES, JOB_RULES, NOTIFICATION_TYPES, ROLES } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import {
  isFollowUpBooked,
  NOT_BOOKED_STATUSES,
  type LaterAppointment,
} from '../modules/encounters/followUp.js';
import { FollowupReminder } from '../modules/followupReminders/model.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import { notify } from '../services/notification.service.js';
import { addDaysToDate, calendarDate, clinicToday } from '../utils/dates.js';
import { logger, serializeError } from '../utils/logger.js';

export interface FollowUpReminderJobResult {
  sent: number;
  skipped: number;
  failed: number;
}

/** '12 Oct 2026' for a calendar date (stored as UTC midnight). */
const formatDay = (date: Date) => formatInTimeZone(date, 'UTC', 'dd MMM yyyy');

/**
 * Follow-up reminders (spec §8.11, §4.10): daily at 09:00 clinic time. Pending reminders whose
 * follow-up is due in exactly two clinic days: already booked (an appointment linked to the visit
 * with `followUpOf`, or a later one with the same doctor, not cancelled or missed) → skipped;
 * no portal login with an email → skipped; otherwise the patient is emailed a booking link with
 * the doctor and the visit prefilled – no clinical details. Each reminder is claimed with a
 * conditional update (`status: 'pending'` → sent/skipped) before anything is sent, so it is never
 * sent twice, even by overlapping runs.
 */
export async function runFollowUpReminderJob(now = new Date()): Promise<FollowUpReminderJobResult> {
  const { timezone } = await getSettings();
  const dueDate = addDaysToDate(clinicToday(timezone, now), FOLLOWUP_RULES.reminderDaysBefore);
  const due = await FollowupReminder.find({ status: 'pending', dueDate: calendarDate(dueDate) })
    .sort({ _id: 1 })
    .limit(JOB_RULES.batchSize)
    .lean();

  const result: FollowUpReminderJobResult = { sent: 0, skipped: 0, failed: 0 };
  const claim = (id: unknown, set: Record<string, unknown>) =>
    FollowupReminder.updateOne({ _id: id, status: 'pending' }, { $set: set });

  for (const r of due) {
    try {
      const appointments = await Appointment.find({
        patient: r.patient,
        status: { $nin: NOT_BOOKED_STATUSES },
        $or: [{ followUpOf: r.appointment }, { doctor: r.doctor, startAt: { $gt: r.visitAt } }],
      })
        .select('doctor startAt followUpOf')
        .lean<LaterAppointment[]>();
      if (isFollowUpBooked(r, appointments)) {
        if ((await claim(r._id, { status: 'skipped', skipReason: 'booked' })).modifiedCount) {
          result.skipped += 1;
        }
        continue;
      }
      const [patientUser, doctor] = await Promise.all([
        User.findOne({ patient: r.patient, role: ROLES.PATIENT, isActive: true })
          .select('email')
          .lean(),
        User.findById(r.doctor).select('firstName lastName').lean(),
      ]);
      if (!patientUser?.email) {
        if ((await claim(r._id, { status: 'skipped', skipReason: 'no_contact' })).modifiedCount) {
          result.skipped += 1;
        }
        continue;
      }
      const claimed = await claim(r._id, { status: 'sent', sentAt: now });
      if (claimed.modifiedCount === 0) continue; // another run or an amendment got there first
      const params = new URLSearchParams({
        doctor: r.doctor.toString(),
        followUpOf: r.appointment.toString(),
      });
      const doctorName = doctor ? `Dr ${doctor.firstName} ${doctor.lastName}` : 'Your doctor';
      await notify({
        recipients: [{ userId: patientUser._id.toString(), email: patientUser.email }],
        type: NOTIFICATION_TYPES.FOLLOWUP_REMINDER,
        title: 'Time to book your follow-up visit',
        body: `${doctorName} asked to see you again around ${formatDay(r.dueDate)}. You can book the visit online.`,
        link: `/patient/appointments/book?${params.toString()}`,
        email: true,
      });
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      logger.error({ err: serializeError(err), job: 'follow-up-reminders' }, 'Reminder failed');
    }
  }
  logger.info(
    { job: 'follow-up-reminders', due: due.length, ...result },
    'Follow-up reminder job finished',
  );
  return result;
}
