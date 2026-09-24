import { AUDIT_ACTIONS, JOB_RULES } from '../config/constants.js';
import { Prescription } from '../modules/prescriptions/model.js';
import * as audit from '../services/audit.service.js';
import { logger, serializeError } from '../utils/logger.js';

export interface PrescriptionCompletionJobResult {
  completed: number;
  skipped: number;
  failed: number;
}

/** Audit actor for background jobs. */
const SYSTEM_ACTOR = { user: null, role: 'system', name: 'Prescription completion job' };
const DAY_MS = 24 * 60 * 60_000;

/**
 * Prescription completion (spec §5.3, §8.11; daily 02:00 clinic time): issued prescriptions
 * whose longest item duration has passed since issue (`issuedAt + max(durationDays) days`)
 * become `completed`. Conditional on still being issued, so a prescription cancelled meanwhile
 * is skipped and a second run never completes one twice. Each completion is audited as the
 * system.
 */
export async function runPrescriptionCompletionJob(
  now = new Date(),
): Promise<PrescriptionCompletionJobResult> {
  const longest = { $max: '$items.durationDays' };
  const due = await Prescription.find({
    status: 'issued',
    issuedAt: { $lte: now },
    $expr: {
      $and: [
        { $gt: [longest, 0] },
        { $lte: [{ $add: ['$issuedAt', { $multiply: [longest, DAY_MS] }] }, now] },
      ],
    },
  })
    .select('_id prescriptionNumber patient')
    .sort({ issuedAt: 1 })
    .limit(JOB_RULES.batchSize)
    .lean();

  const result: PrescriptionCompletionJobResult = { completed: 0, skipped: 0, failed: 0 };
  for (const rx of due) {
    try {
      const res = await Prescription.updateOne(
        { _id: rx._id, status: 'issued' },
        { $set: { status: 'completed', completedAt: now }, $inc: { __v: 1 } },
      );
      if (res.modifiedCount === 0) {
        result.skipped += 1;
        continue;
      }
      await audit.record({
        action: AUDIT_ACTIONS.PRESCRIPTION_COMPLETE,
        actor: SYSTEM_ACTOR,
        resource: { type: 'prescription', id: rx._id, number: rx.prescriptionNumber ?? undefined },
        patient: rx.patient,
        request: { id: 'job', method: 'JOB', path: 'jobs/prescription-completion' },
        metadata: { via: 'job' },
      });
      result.completed += 1;
    } catch (err) {
      result.failed += 1;
      logger.error(
        { err: serializeError(err), job: 'prescription-completion' },
        'Prescription completion failed',
      );
    }
  }
  logger.info(
    { job: 'prescription-completion', due: due.length, ...result },
    'Prescription completion job finished',
  );
  return result;
}
