import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ERROR_CODES } from '../../config/constants.js';
import { assertCanWriteEncounter } from '../../policies/encounterAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { Appointment } from '../appointments/model.js';
import {
  announceAppointment,
  loadAppointment,
  resourceOf as appointmentResource,
} from '../appointments/service.js';
import { applyTransition } from '../appointments/status.service.js';
import { Prescription } from '../prescriptions/model.js';
import {
  afterIssued,
  allergyAckRequired,
  issueDraftInSession,
  issueProblems,
  patientAllergies,
  unacknowledgedAllergies,
  type FieldProblem,
} from '../prescriptions/service.js';
import { toDoctorView as prescriptionView } from '../prescriptions/serializer.js';
import { Encounter } from './model.js';
import { ENCOUNTER_POPULATE, toDoctorView, type EncounterLike } from './serializer.js';
import { assertDocumentationOpen, loadEncounter, resourceOf } from './service.js';

/**
 * What the note lacks to be signed (spec §8.5): a chief complaint and at least one diagnosis;
 * plus, when the draft prescription has items, every item complete (§8.6).
 */
export function signProblems(
  e: Pick<EncounterLike, 'chiefComplaint' | 'diagnoses'>,
  prescriptionItems: Parameters<typeof issueProblems>[0],
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (!e.chiefComplaint?.trim()) {
    problems.push({ field: 'chiefComplaint', message: 'Chief complaint is required' });
  }
  if (!e.diagnoses?.length) {
    problems.push({ field: 'diagnoses', message: 'Add at least one diagnosis' });
  }
  problems.push(...issueProblems(prescriptionItems, 'prescription.'));
  return problems;
}

/** Warnings that do not block signing (spec §8.5: empty vitals). */
function signWarnings(e: EncounterLike): string[] {
  const v = e.vitals ?? {};
  const recorded = [
    v.bpSystolic,
    v.bpDiastolic,
    v.pulse,
    v.temperatureC,
    v.respiratoryRate,
    v.spo2,
    v.weightKg,
    v.heightCm,
  ].some((x) => x !== null && x !== undefined);
  return recorded ? [] : ['No vitals were recorded for this visit.'];
}

/**
 * POST /encounters/:id/sign (spec §4.7 step 5) – the note's doctor, within the documentation
 * window, with the revision they are looking at (`expectedVersion`, 409 CONFLICT if stale).
 * Checks → 422 SIGN_VALIDATION_FAILED / ALLERGY_ACK_REQUIRED (`details` list what is missing),
 * then in ONE transaction: note → signed; the draft prescription (if it has items) → issued with
 * its RX number; the appointment in consultation → completed. Signing twice → 409
 * INVALID_STATUS_TRANSITION. Audit and real-time events after the commit.
 */
export async function signEncounter(
  user: AuthUser,
  id: string,
  { expectedVersion }: { expectedVersion: number },
  meta: RequestMeta,
) {
  const e = await loadEncounter(id);
  await assertCanWriteEncounter(user, e, meta);
  assertTransition('encounter', e.status, 'signed');
  await assertDocumentationOpen(e.appointment);
  if ((e.__v ?? 0) !== expectedVersion) {
    throw ApiError.conflict(
      'This note was changed in another tab or window. Reload it and check it before signing.',
      { currentRevision: e.__v ?? 0 },
    );
  }

  const draft = await Prescription.findOne({
    encounter: e._id,
    isCurrent: true,
    status: 'draft',
  }).lean();
  const rxItems = draft?.items ?? [];
  const problems = signProblems(e, rxItems);
  if (problems.length > 0) {
    throw new ApiError(
      422,
      'The note cannot be signed yet',
      ERROR_CODES.SIGN_VALIDATION_FAILED,
      problems,
    );
  }
  if (rxItems.length > 0) {
    const unacknowledged = unacknowledgedAllergies(
      rxItems,
      await patientAllergies(e.patient._id),
      'prescription.',
    );
    if (unacknowledged.length > 0) throw allergyAckRequired(unacknowledged);
  }

  const now = new Date();
  const result = await withTransaction(async (session) => {
    const signed = await Encounter.findOneAndUpdate(
      { _id: e._id, status: 'draft', __v: expectedVersion },
      {
        $set: { status: 'signed', signedAt: now, signedBy: user.id, updatedBy: user.id },
        $inc: { __v: 1 },
      },
      { new: true, session },
    ).lean();
    if (!signed) {
      const fresh = await Encounter.findById(e._id).select('status').session(session).lean();
      if (fresh && fresh.status !== 'draft') {
        throw invalidTransition('encounter', fresh.status, 'signed');
      }
      throw ApiError.conflict('This note was changed in another tab or window. Reload it.');
    }

    let prescriptionId: Types.ObjectId | null = null;
    if (draft && rxItems.length > 0) {
      prescriptionId = (await issueDraftInSession(draft, { by: user.id, session, now }))._id;
    }

    const appt = await Appointment.findById(e.appointment)
      .select('status isOverbook')
      .session(session)
      .lean();
    let appointmentCompleted = false;
    if (appt?.status === 'in_consultation') {
      await applyTransition(
        appt,
        'completed',
        { 'queue.completedAt': now, updatedBy: user.id },
        user.id,
        'Note signed',
        { session },
      );
      appointmentCompleted = true;
    }
    // TODO(Phase 6): submit the encounter's draft lab orders here (spec §4.7 step 5).
    // TODO(Phase 7): create or update the appointment's draft invoice.
    // TODO(Phase 8): schedule the follow-up reminder from `followUp` (§8.11).
    return { prescriptionId, appointmentCompleted };
  });

  // After the commit: audit, real-time events, notifications.
  await audit.record({
    action: AUDIT_ACTIONS.ENCOUNTER_SIGN,
    actor: actorOf(user),
    resource: resourceOf(e),
    patient: e.patient._id,
    request: meta,
    metadata: {
      version: e.version,
      prescriptionIssued: result.prescriptionId !== null,
      appointmentCompleted: result.appointmentCompleted,
    },
  });
  const appointment = await loadAppointment(e.appointment);
  if (result.appointmentCompleted) {
    await audit.record({
      action: AUDIT_ACTIONS.APPOINTMENT_COMPLETE,
      actor: actorOf(user),
      resource: appointmentResource(appointment),
      patient: appointment.patient._id,
      request: meta,
      metadata: { via: 'sign' },
    });
  }
  const prescription = result.prescriptionId
    ? await afterIssued(user, result.prescriptionId, meta, 'sign')
    : null;
  void announceAppointment(appointment);

  const signed = await Encounter.findById(e._id)
    .populate([...ENCOUNTER_POPULATE])
    .lean();
  return {
    encounter: toDoctorView(signed as unknown as EncounterLike),
    prescription: prescription ? prescriptionView(prescription) : null,
    appointment: { id: appointment._id.toString(), status: appointment.status },
    warnings: signWarnings(e),
  };
}
