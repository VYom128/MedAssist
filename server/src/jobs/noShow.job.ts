import { AUDIT_ACTIONS, JOB_RULES, NOTIFICATION_TYPES } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import {
  announceAppointment,
  notifyAppointment,
  resourceOf,
} from '../modules/appointments/service.js';
import { applyTransition } from '../modules/appointments/status.service.js';
import { getSettings } from '../modules/settings/service.js';
import * as audit from '../services/audit.service.js';
import { ApiError } from '../utils/ApiError.js';
import { logger, serializeError } from '../utils/logger.js';

export interface NoShowJobResult {
  marked: number;
  skipped: number;
  failed: number;
}

/** Audit actor for background jobs. */
const SYSTEM_ACTOR = { user: null, role: 'system', name: 'No-show job' };

/**
 * No-show marking (spec §4.6 step 5, §8.11): scheduled appointments whose `endAt +
 * noShowGraceMinutes` has passed become `no_show` (slot released), by the system. Appointments
 * whose no-show reception undid (`noShowUndoneAt`) are left alone. Each is audited, announced
 * over Socket.IO and the patient is emailed. An appointment that changed meanwhile (checked in
 * at the last moment) is skipped.
 */
export async function runNoShowJob(now = new Date()): Promise<NoShowJobResult> {
  const settings = await getSettings();
  const cutoff = new Date(now.getTime() - settings.appointment!.noShowGraceMinutes * 60_000);
  const due = await Appointment.find({
    status: 'scheduled',
    endAt: { $lt: cutoff },
    noShowUndoneAt: null,
  })
    .select('_id status isOverbook')
    .sort({ endAt: 1 })
    .limit(JOB_RULES.batchSize)
    .lean();

  const result: NoShowJobResult = { marked: 0, skipped: 0, failed: 0 };
  for (const appt of due) {
    try {
      const missed = await applyTransition(appt, 'no_show', {}, null, 'Not checked in (automatic)');
      await audit.record({
        action: AUDIT_ACTIONS.APPOINTMENT_NO_SHOW,
        actor: SYSTEM_ACTOR,
        resource: resourceOf(missed),
        patient: missed.patient._id,
        request: { id: 'job', method: 'JOB', path: 'jobs/no-show' },
        metadata: { via: 'job' },
      });
      await announceAppointment(missed);
      await notifyAppointment(NOTIFICATION_TYPES.APPOINTMENT_NO_SHOW, missed);
      result.marked += 1;
    } catch (err) {
      if (err instanceof ApiError) {
        result.skipped += 1; // status changed since the query (409 from the conditional update)
      } else {
        result.failed += 1;
        logger.error({ err: serializeError(err), job: 'no-show' }, 'No-show marking failed');
      }
    }
  }
  logger.info({ job: 'no-show', due: due.length, ...result }, 'No-show job finished');
  return result;
}
