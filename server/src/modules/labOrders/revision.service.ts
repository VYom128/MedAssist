import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ERROR_CODES } from '../../config/constants.js';
import { assertLabTechOn } from '../../policies/labOrderAccess.js';
import * as audit from '../../services/audit.service.js';
import { emitLabOrderChanged, emitLabWorklistUpdated } from '../../socket/emitter.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { withTransaction } from '../../utils/transaction.js';
import { Patient } from '../patients/model.js';
import { getSettings } from '../settings/service.js';
import { LabOrder, revisionWriteOptions, type LabOrderItem } from './model.js';
import { alertCritical, notifyResultsReleased } from './notify.js';
import { isCriticalFlag } from './ranges.js';
import { prepareReleaseReport } from './report.js';
import type { BuiltResult, ResultInput } from './results.js';
import { toLabView, type LabOrderLike } from './serializer.js';
import { loadLabOrder, patientIdOf, resourceOf } from './service.js';
import { applyOrderTransition } from './status.service.js';
import { findItem, flaggedResults, refreshHasCritical } from './workflow.service.js';

/**
 * Revisions after release (spec §4.8 "Corrections after release", Phase 6 decisions). A lab
 * technician revises one test with a reason: with dual verification on it waits as the item's
 * `pendingRevision` until a DIFFERENT lab technician verifies it; with it off it applies at once.
 * Applying keeps the old version in `previousResults`, bumps `resultVersion`, makes a new report
 * PDF, clears the doctor's acknowledgement and notifies the patient and the doctor. Until then
 * the patient keeps seeing the last released version. Released items change only here, with
 * `revisionWriteOptions()`.
 */

interface Revision {
  results: BuiltResult[] | LabOrderItem['results'];
  remarks?: string | null;
  reason: string;
  by: Types.ObjectId | string;
  at: Date;
}

const conflict = (message: string, from: string) =>
  new ApiError(409, message, ERROR_CODES.INVALID_STATUS_TRANSITION, { from, to: 'released' });

/** A released order's verified item, for a lab technician. */
async function releasedItem(user: AuthUser, id: string, itemId: string, meta: RequestMeta) {
  const o = await loadLabOrder(id);
  await assertLabTechOn(user, o, meta);
  if (o.status !== 'released') {
    throw conflict(
      'Only released results are revised. Before release, send the order back or re-enter the results.',
      o.status,
    );
  }
  const item = findItem(o, itemId);
  if (item.status !== 'verified') throw conflict('This test has no released results', item.status);
  return { o, item };
}

const auditRevision = (
  user: AuthUser,
  action: typeof AUDIT_ACTIONS.LAB_ORDER_REVISE | typeof AUDIT_ACTIONS.LAB_ORDER_REVISION_VERIFY,
  o: LabOrderLike,
  meta: RequestMeta,
  fields: string[],
  metadata: Record<string, unknown>,
) =>
  audit.record({
    action,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
    changes: { fields },
    metadata,
  });

/**
 * Applies a revision in one transaction (new report saved inside it). Guarded by the item's
 * current version (and, for a pending revision, its timestamp), so it applies once.
 * @returns the new result version.
 */
async function applyRevision(
  verifier: AuthUser,
  o: LabOrderLike,
  item: LabOrderItem,
  revision: Revision,
  guard: Record<string, unknown>,
) {
  const version = item.resultVersion ?? 1;
  const now = new Date();
  // The PDF shows the order as it will read after the revision.
  const current = await loadLabOrder(o._id, { detail: true });
  const revised = {
    ...current,
    items: current.items.map((i) =>
      i._id.equals(item._id)
        ? {
            ...i,
            results: revision.results,
            remarks: revision.remarks ?? undefined,
            resultVersion: version + 1,
            verifiedBy: {
              _id: verifier.id,
              firstName: verifier.firstName,
              lastName: verifier.lastName,
            },
            verifiedAt: now,
          }
        : i,
    ),
  } as unknown as LabOrderLike;
  const report = await prepareReleaseReport(revised, {
    kind: 'revision',
    releasedAt: now,
    releasedBy: `${verifier.firstName} ${verifier.lastName}`,
    createdBy: verifier.id,
  });
  const at = (field: string) => `items.$[it].${field}`;
  const previous = {
    version,
    results: item.results,
    ...(item.remarks ? { remarks: item.remarks } : {}),
    ...(item.enteredBy ? { enteredBy: item.enteredBy } : {}),
    ...(item.verifiedBy ? { verifiedBy: item.verifiedBy } : {}),
    revisedBy: revision.by,
    revisedAt: now,
    reason: revision.reason,
  };
  const unset: Record<string, ''> = {
    [at('pendingRevision')]: '',
    reviewedByDoctorAt: '',
    reviewedBy: '',
  };
  if (!revision.remarks) unset[at('remarks')] = '';
  try {
    await withTransaction(async (session) => {
      const documentId = await report.save(session);
      const filter = { items: { $elemMatch: { _id: item._id, resultVersion: version, ...guard } } };
      const unchanged = await LabOrder.exists({ _id: o._id, ...filter }).session(session);
      if (!unchanged) {
        throw ApiError.conflict('These results changed meanwhile. Reload the order.');
      }
      await applyOrderTransition(
        o,
        'released',
        {
          [at('results')]: revision.results,
          ...(revision.remarks ? { [at('remarks')]: revision.remarks } : {}),
          [at('resultVersion')]: version + 1,
          [at('enteredBy')]: revision.by,
          [at('enteredAt')]: revision.at,
          [at('verifiedBy')]: verifier.id,
          [at('verifiedAt')]: now,
          reportDocument: documentId,
        },
        verifier.id,
        'Results revised',
        {
          session,
          at: now,
          extra: { $push: { [at('previousResults')]: previous }, $unset: unset },
          queryOptions: {
            ...revisionWriteOptions(session),
            arrayFilters: [{ 'it._id': item._id, 'it.resultVersion': version }],
          },
        },
      );
      await refreshHasCritical(o._id, session);
    });
  } catch (err) {
    await report.discard(err);
    throw err;
  }

  if (revision.results.some((r) => isCriticalFlag(r.flag))) {
    await alertCritical(o, item._id, version + 1, revisionWriteOptions());
  }
  void notifyResultsReleased(o, 'revision');
  emitLabWorklistUpdated([o._id.toString()]);
  const account = (await Patient.findById(patientIdOf(o)).select('user').lean())?.user;
  emitLabOrderChanged(o._id.toString(), [
    o.orderedBy._id.toString(),
    ...(account ? [account.toString()] : []),
  ]);
  return version + 1;
}

/**
 * POST /lab-orders/:id/items/:itemId/revise – `{ results, remarks, reason }` for a released test.
 * The revision must be complete (422 RESULTS_INCOMPLETE); flags are computed as for entry. One
 * pending revision per test (409 CONFLICT for a second).
 */
export async function reviseItem(
  user: AuthUser,
  id: string,
  itemId: string,
  input: { results: ResultInput[]; remarks?: string | null; reason: string },
  meta: RequestMeta,
) {
  const { o, item } = await releasedItem(user, id, itemId, meta);
  if (item.pendingRevision?.at) {
    throw ApiError.conflict('A revision of this test is already waiting for verification');
  }
  const built = await flaggedResults(o, item.test, input.results);
  if (built.missing.length > 0) {
    throw new ApiError(
      422,
      'A revision needs a value for every parameter',
      ERROR_CODES.RESULTS_INCOMPLETE,
      built.missing.map((key) => ({
        field: 'body.results',
        parameterKey: key,
        message: 'Required',
      })),
    );
  }
  const now = new Date();
  const remarks = input.remarks === undefined ? (item.remarks ?? null) : input.remarks;
  const revision: Revision = {
    results: built.results,
    remarks,
    reason: input.reason,
    by: user.id,
    at: now,
  };
  const fields = built.results.map((r) => r.parameterKey);
  const settings = await getSettings();

  if (settings.lab?.requireDualVerification === false) {
    const version = await applyRevision(user, o, item, revision, {});
    await auditRevision(user, AUDIT_ACTIONS.LAB_ORDER_REVISE, o, meta, fields, {
      itemId,
      applied: true,
      resultVersion: version,
      reasonGiven: true,
    });
    return toLabView(await loadLabOrder(o._id, { detail: true }));
  }

  const at = (field: string) => `items.$[it].${field}`;
  const pending = await LabOrder.updateOne(
    {
      _id: o._id,
      status: 'released',
      items: { $elemMatch: { _id: item._id, status: 'verified', 'pendingRevision.at': null } },
    },
    {
      $set: {
        [at('pendingRevision')]: {
          results: built.results,
          ...(remarks ? { remarks } : {}),
          reason: input.reason,
          by: user.id,
          at: now,
        },
        updatedBy: user.id,
      },
      $inc: { __v: 1 },
    },
    { arrayFilters: [{ 'it._id': item._id }], ...revisionWriteOptions() },
  );
  if (pending.matchedCount === 0) {
    throw ApiError.conflict('A revision of this test is already waiting for verification');
  }
  await auditRevision(user, AUDIT_ACTIONS.LAB_ORDER_REVISE, o, meta, fields, {
    itemId,
    applied: false,
    reasonGiven: true,
  });
  emitLabWorklistUpdated([o._id.toString()]);
  return toLabView(await loadLabOrder(o._id, { detail: true }));
}

/**
 * POST /lab-orders/:id/items/:itemId/verify-revision – a different lab technician (when dual
 * verification is on: 422 SELF_VERIFICATION_NOT_ALLOWED otherwise) verifies the pending revision,
 * which then replaces the released results.
 */
export async function verifyRevision(
  user: AuthUser,
  id: string,
  itemId: string,
  meta: RequestMeta,
) {
  const { o, item } = await releasedItem(user, id, itemId, meta);
  const pending = item.pendingRevision;
  if (!pending?.at) throw conflict('No revision of this test is waiting', o.status);
  const settings = await getSettings();
  const dual = settings.lab?.requireDualVerification !== false;
  if (dual && pending.by?.toString() === user.id) {
    throw new ApiError(
      422,
      'A revision must be verified by a different lab technician from the one who made it',
      ERROR_CODES.SELF_VERIFICATION_NOT_ALLOWED,
    );
  }
  const version = await applyRevision(
    user,
    o,
    item,
    {
      results: pending.results,
      remarks: pending.remarks ?? null,
      reason: pending.reason ?? '',
      by: pending.by!,
      at: pending.at,
    },
    { 'pendingRevision.at': pending.at },
  );
  await auditRevision(
    user,
    AUDIT_ACTIONS.LAB_ORDER_REVISION_VERIFY,
    o,
    meta,
    pending.results.map((r) => r.parameterKey),
    { itemId, resultVersion: version, dualVerification: dual },
  );
  return toLabView(await loadLabOrder(o._id, { detail: true }));
}
