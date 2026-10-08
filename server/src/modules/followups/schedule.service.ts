import { AUDIT_ACTIONS, ROLES } from '../../config/constants.js';
import { assertCanHandleFollowup } from '../../policies/followupAccess.js';
import * as audit from '../../services/audit.service.js';
import { emitFollowupUpdated } from '../../socket/emitter.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition } from '../../utils/stateMachine.js';
import { bookAppointment } from '../appointments/booking.service.js';
import { Appointment } from '../appointments/model.js';
import { User } from '../users/model.js';
import { resourceOf, toView } from './serializer.js';
import { loadFollowup, transitionFollowup } from './service.js';
import type { ScheduleFollowupInput } from './validation.js';

/**
 * POST /follow-up-requests/:id/schedule (spec §4.10, §7.13) – reception or the assigned doctor
 * books a follow-up appointment for the request. The appointment goes through the normal booking
 * service (every conflict check and the booking lock; `type: follow_up`, `followUpOf` = the
 * related visit when it was completed), and the request moves to 'scheduled' with the
 * appointment **in the same transaction**: a booking conflict (409) leaves the request unchanged,
 * and a request scheduled by someone else meanwhile (409) books nothing. Doctors schedule with
 * themselves only; reception with any doctor (default: the assigned one). The patient gets the
 * normal booking confirmation email.
 */
export async function scheduleFollowup(
  user: AuthUser,
  id: string,
  input: ScheduleFollowupInput,
  meta: RequestMeta,
) {
  const r = await loadFollowup(id);
  await assertCanHandleFollowup(user, r, meta);
  assertTransition('followupRequest', r.status, 'scheduled');

  const doctorId = input.doctorId ?? r.assignedDoctor?._id.toString();
  if (!doctorId) {
    throw ApiError.unprocessable('Choose a doctor for the appointment', [
      { field: 'body.doctorId', message: 'Required (no doctor is assigned)' },
    ]);
  }
  if (user.role === ROLES.DOCTOR && doctorId !== user.id) {
    throw ApiError.forbidden('Doctors schedule follow-ups with themselves only');
  }
  const related = r.relatedAppointment
    ? await Appointment.findById(r.relatedAppointment).select('status').lean()
    : null;

  const appointment = await bookAppointment(
    user,
    {
      patientId: r.patient._id.toString(),
      doctorId,
      serviceId: input.serviceId,
      startAt: input.startAt,
      type: 'follow_up',
      reason: `Follow-up request ${r.requestNumber}`,
      followUpOf: related?.status === 'completed' ? related._id.toString() : undefined,
    },
    meta,
    {
      inTransaction: async (session, created) => {
        await transitionFollowup(r, 'scheduled', user.id, {
          set: { resultingAppointment: created._id },
          session,
        });
      },
    },
  );

  await audit.record({
    action: AUDIT_ACTIONS.FOLLOWUP_SCHEDULE,
    actor: actorOf(user),
    resource: resourceOf(r),
    patient: r.patient._id,
    request: meta,
    changes: { fields: ['status', 'resultingAppointment'] },
    metadata: { from: r.status, to: 'scheduled', appointment: appointment.id },
  });
  const fresh = await loadFollowup(r._id);
  const patientUser = await User.findOne({ patient: r.patient._id, role: ROLES.PATIENT })
    .select('_id')
    .lean();
  emitFollowupUpdated(
    fresh._id.toString(),
    [fresh.assignedDoctor?._id.toString(), patientUser?._id.toString()].filter((x): x is string =>
      Boolean(x),
    ),
  );
  return { request: toView(fresh, user.role), appointment };
}
