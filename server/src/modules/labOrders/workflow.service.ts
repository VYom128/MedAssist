import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  LAB_ORDER_RULES,
  LAB_REVIEWABLE_STATUSES,
  SEQUENCES,
  type LabOrderStatus,
} from '../../config/constants.js';
import { assertCanReadLabOrder, assertLabTechOn } from '../../policies/labOrderAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { emitLabOrderChanged, emitLabWorklistUpdated } from '../../socket/emitter.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { ageOn, clinicToday } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { LabTest } from '../labTests/model.js';
import { Patient } from '../patients/model.js';
import { getSettings } from '../settings/service.js';
import { LabOrder } from './model.js';
import { alertCritical, notifyResultsReleased, notifySampleRejected } from './notify.js';
import { isCriticalFlag } from './ranges.js';
import { prepareReleaseReport } from './report.js';
import { buildResults, type ResultInput } from './results.js';
import { toDoctorView, toLabView, type LabOrderLike } from './serializer.js';
import { loadLabOrder, patientIdOf, resourceOf } from './service.js';
import { applyOrderTransition, recomputeOrderStatus } from './status.service.js';

/**
 * The lab's side of an order (spec §4.8, §5.4, §7.14): sample collection, rejection and
 * recollection, processing, result entry with server-computed flags, verification (dual
 * verification per settings), send-back, release, and the doctor's acknowledgement. Every status
 * change goes through applyOrderTransition; audit entries record field names and counts only
 * (never values); events carry ids only and are sent after the commit.
 */

const labView = async (id: Types.ObjectId) => toLabView(await loadLabOrder(id, { detail: true }));

/** Loads the order for a lab technician (placed orders only; others 404). */
async function forLab(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await loadLabOrder(id);
  await assertLabTechOn(user, o, meta);
  return o;
}

const record = (
  user: AuthUser,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  o: LabOrderLike,
  meta: RequestMeta,
  extra: { metadata?: Record<string, unknown>; changes?: { fields: string[] } } = {},
) =>
  audit.record({
    action,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
    ...extra,
  });

/** The patient's portal account (for `lab.order.changed` once released). */
async function patientUserId(o: LabOrderLike): Promise<string | null> {
  const p = await Patient.findById(patientIdOf(o)).select('user').lean();
  return p?.user?.toString() ?? null;
}

/** After a change: the lab's worklist, the ordering doctor (and the patient when released). */
async function announce(o: LabOrderLike, { patient = false }: { patient?: boolean } = {}) {
  emitLabWorklistUpdated([o._id.toString()]);
  const users = [o.orderedBy._id.toString()];
  if (patient) {
    const account = await patientUserId(o);
    if (account) users.push(account);
  }
  emitLabOrderChanged(o._id.toString(), users);
}

const notAllowedNow = (message: string, from: string, to: string) =>
  new ApiError(409, message, ERROR_CODES.INVALID_STATUS_TRANSITION, { from, to });

/**
 * Two actions lead to `processing` (start from sample_collected, send-back from result_entered):
 * each checks its own starting status, not only the transition table.
 */
function assertFrom(o: { status: string }, from: string, to: LabOrderStatus) {
  if (o.status !== from) throw invalidTransition('labOrder', o.status, to);
}

/**
 * `hasCritical` from the results now stored (a corrected value clears it). Touches no items, so
 * it is allowed on released orders too.
 */
export async function refreshHasCritical(orderId: Types.ObjectId, session?: ClientSession) {
  const o = await LabOrder.findById(orderId)
    .select('items.status items.results.flag')
    .session(session ?? null)
    .lean();
  const hasCritical = (o?.items ?? []).some(
    (i) => i.status !== 'cancelled' && (i.results ?? []).some((r) => isCriticalFlag(r.flag)),
  );
  await LabOrder.updateOne({ _id: orderId }, { $set: { hasCritical } }, { session });
}

// ---- Sample (spec §4.8) ----------------------------------------------------------------------

/** The label printed for the sample tube (barcode = sampleId). */
function labelOf(o: LabOrderLike) {
  return {
    sampleId: o.sample?.sampleId ?? null,
    orderNumber: o.orderNumber ?? null,
    priority: o.priority,
    patient: {
      fullName: `${o.patient.firstName} ${o.patient.lastName}`,
      mrn: o.patient.mrn,
      age: o.sample?.patientAgeYears ?? null,
      gender: o.patient.gender,
    },
    sampleType: o.sample?.type ?? null,
    collectedAt: o.sample?.collectedAt ?? null,
    tests: o.items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({ code: i.testSnapshot.code, name: i.testSnapshot.name })),
  };
}

/**
 * POST /lab-orders/:id/collect-sample – ordered → sample_collected. The sample id
 * (S<yy>-000001) comes from the counter inside the transaction; the sample type from the tests;
 * the patient's age at collection is stored (reference ranges use it). Returns the order and the
 * label data.
 */
export async function collectSample(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await forLab(user, id, meta);
  assertTransition('labOrder', o.status, 'sample_collected');
  const { timezone } = await getSettings();
  const now = new Date();
  const today = clinicToday(timezone, now);
  const types = [
    ...new Set(
      o.items.filter((i) => i.status !== 'cancelled').map((i) => i.testSnapshot.sampleType),
    ),
  ].filter(Boolean);

  const updated = await withTransaction(async (session) => {
    const seq = await nextSequence(`${SEQUENCES.SAMPLE.key}:${today.slice(0, 4)}`, { session });
    const sampleId = formatNumber(`${SEQUENCES.SAMPLE.prefix}${today.slice(2, 4)}`, seq);
    return applyOrderTransition(
      o,
      'sample_collected',
      {
        sample: {
          sampleId,
          type: types.length > 0 ? types.join(', ') : 'other',
          collectedBy: user.id,
          collectedAt: now,
          patientAgeYears: ageOn(o.patient.dateOfBirth, today),
        },
      },
      user.id,
      `Sample ${sampleId} collected`,
      { session, at: now },
    );
  });

  await record(user, AUDIT_ACTIONS.LAB_ORDER_COLLECT_SAMPLE, o, meta, {
    metadata: { sampleId: updated.sample?.sampleId },
  });
  await announce(o);
  const fresh = await loadLabOrder(o._id, { detail: true });
  return { ...toLabView(fresh), label: labelOf(fresh) };
}

/**
 * POST /lab-orders/:id/reject-sample – sample_collected → sample_rejected with a reason; the
 * patient and receptionists are asked to arrange a new sample (no clinical details).
 */
export async function rejectSample(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const o = await forLab(user, id, meta);
  const now = new Date();
  await applyOrderTransition(
    o,
    'sample_rejected',
    { 'sample.rejection': { reason, by: user.id, at: now } },
    user.id,
    'Sample rejected',
    { at: now },
  );
  await record(user, AUDIT_ACTIONS.LAB_ORDER_REJECT_SAMPLE, o, meta, {
    metadata: { sampleId: o.sample?.sampleId, reasonGiven: true },
  });
  void notifySampleRejected(o);
  await announce(o);
  return labView(o._id);
}

/**
 * POST /lab-orders/:id/recollect – sample_rejected → ordered, ready for a new sample. The rejected
 * sample's id and reason stay in the status history.
 */
export async function recollectSample(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await forLab(user, id, meta);
  const rejected = o.sample?.sampleId ?? 'sample';
  const note = `${rejected} rejected: ${o.sample?.rejection?.reason ?? 'no reason given'}`.slice(
    0,
    LAB_ORDER_RULES.reasonMaxLength,
  );
  await applyOrderTransition(o, 'ordered', {}, user.id, note, {
    extra: { $unset: { sample: '' } },
  });
  await record(user, AUDIT_ACTIONS.LAB_ORDER_RECOLLECT, o, meta, {
    metadata: { rejectedSampleId: o.sample?.sampleId },
  });
  await announce(o);
  return labView(o._id);
}

/** POST /lab-orders/:id/start-processing – sample_collected → processing. */
export async function startProcessing(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await forLab(user, id, meta);
  assertFrom(o, 'sample_collected', 'processing');
  await applyOrderTransition(o, 'processing', {}, user.id, undefined);
  await record(user, AUDIT_ACTIONS.LAB_ORDER_START_PROCESSING, o, meta);
  await announce(o);
  return labView(o._id);
}

// ---- Results ---------------------------------------------------------------------------------

/** The item's catalogue parameters (the test as it is now; inactive tests still count). */
export async function parametersOf(testId: Types.ObjectId) {
  const test = await LabTest.findById(testId).select('parameters').lean();
  return (test?.parameters ?? []).map((p) => ({
    key: p.key,
    name: p.name,
    unit: p.unit ?? null,
    valueType: p.valueType,
    options: p.options ?? [],
    abnormalOptions: p.abnormalOptions ?? [],
    ranges: p.ranges ?? [],
  }));
}

/** Validates and flags `results` for an item of `o` → 400 with field details on bad values. */
export async function flaggedResults(
  o: LabOrderLike,
  testId: Types.ObjectId,
  input: ResultInput[],
) {
  const built = buildResults(await parametersOf(testId), input, {
    gender: o.patient.gender,
    ageYears: o.sample?.patientAgeYears ?? null,
  });
  if (built.issues.length > 0) {
    throw ApiError.validation('Check the highlighted results', built.issues);
  }
  return built;
}

export const findItem = (o: LabOrderLike, itemId: string) => {
  const item = o.items.find((i) => i._id.toString() === itemId);
  if (!item) throw ApiError.notFound('Test not found in this order');
  return item;
};

/**
 * PUT /lab-orders/:id/items/:itemId/results – while the order is processing. The server
 * validates each value against its parameter and computes flags; client flags are ignored.
 * Partial saves are allowed; the item becomes result_entered (enteredBy/At) once every parameter
 * has a value, and the order result_entered once every open item has. Critical values alert the
 * ordering doctor at once (once per result version).
 */
export async function saveItemResults(
  user: AuthUser,
  id: string,
  itemId: string,
  input: { results: ResultInput[]; remarks?: string | null },
  meta: RequestMeta,
) {
  const o = await forLab(user, id, meta);
  if (o.status !== 'processing') {
    throw notAllowedNow(
      `This lab order is ${o.status.replace(/_/g, ' ')}: results are entered while it is processing`,
      o.status,
      'result_entered',
    );
  }
  const item = findItem(o, itemId);
  if (item.status === 'cancelled') {
    throw notAllowedNow('This test was cancelled', item.status, 'result_entered');
  }
  const built = await flaggedResults(o, item.test, input.results);
  const complete = built.missing.length === 0;
  const now = new Date();
  const itemOid = item._id;
  const at = (field: string) => `items.$[it].${field}`;
  const set: Record<string, unknown> = {
    [at('results')]: built.results,
    [at('status')]: complete ? 'result_entered' : 'pending',
    updatedBy: user.id,
  };
  const unset: Record<string, ''> = {};
  if (complete) {
    set[at('enteredBy')] = user.id;
    set[at('enteredAt')] = now;
  } else {
    unset[at('enteredBy')] = '';
    unset[at('enteredAt')] = '';
  }
  if (input.remarks) set[at('remarks')] = input.remarks;
  else if (input.remarks === null) unset[at('remarks')] = '';

  const status = await withTransaction(async (session) => {
    const updated = await LabOrder.updateOne(
      {
        _id: o._id,
        status: 'processing',
        items: { $elemMatch: { _id: itemOid, status: { $in: ['pending', 'result_entered'] } } },
      },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $inc: { __v: 1 } },
      { arrayFilters: [{ 'it._id': itemOid }], session },
    );
    if (updated.matchedCount === 0) {
      throw ApiError.conflict('This lab order changed meanwhile. Reload it and try again.');
    }
    await refreshHasCritical(o._id, session);
    return recomputeOrderStatus(o._id, { by: user.id, session, note: 'All results entered' });
  });

  await record(user, AUDIT_ACTIONS.LAB_ORDER_RESULTS_ENTER, o, meta, {
    changes: { fields: built.results.map((r) => r.parameterKey) },
    metadata: { itemId, complete, missing: built.missing.length, orderStatus: status },
  });
  if (built.critical > 0) await alertCritical(o, itemOid, item.resultVersion ?? 1);
  emitLabWorklistUpdated([o._id.toString()]);
  if (status === 'result_entered')
    emitLabOrderChanged(o._id.toString(), [o.orderedBy._id.toString()]);
  return labView(o._id);
}

// ---- Verification, send-back, release ---------------------------------------------------------

/**
 * POST /lab-orders/:id/verify – result_entered → verified, every open item verified. Every open
 * item must have complete results (422 RESULTS_INCOMPLETE); with dual verification on, the
 * verifier must not have entered any of them (422 SELF_VERIFICATION_NOT_ALLOWED).
 */
export async function verifyOrder(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await forLab(user, id, meta);
  assertTransition('labOrder', o.status, 'verified');
  const open = o.items.filter((i) => i.status !== 'cancelled');
  const incomplete = open.filter((i) => i.status !== 'result_entered');
  if (incomplete.length > 0) {
    throw new ApiError(
      422,
      'Some tests have no complete results yet',
      ERROR_CODES.RESULTS_INCOMPLETE,
      incomplete.map((i) => ({ field: `items.${i._id.toString()}`, message: 'Results missing' })),
    );
  }
  const settings = await getSettings();
  const dual = settings.lab?.requireDualVerification !== false;
  if (dual && open.some((i) => i.enteredBy?.toString() === user.id)) {
    throw new ApiError(
      422,
      'Results must be verified by a different lab technician from the one who entered them',
      ERROR_CODES.SELF_VERIFICATION_NOT_ALLOWED,
    );
  }
  const now = new Date();
  await applyOrderTransition(
    o,
    'verified',
    {
      'items.$[open].status': 'verified',
      'items.$[open].verifiedBy': user.id,
      'items.$[open].verifiedAt': now,
    },
    user.id,
    undefined,
    { at: now, queryOptions: { arrayFilters: [{ 'open.status': 'result_entered' }] } },
  );
  await record(user, AUDIT_ACTIONS.LAB_ORDER_VERIFY, o, meta, {
    metadata: { itemCount: open.length, dualVerification: dual },
  });
  await announce(o);
  return labView(o._id);
}

/**
 * POST /lab-orders/:id/send-back – the verifier found an error: result_entered → processing,
 * with a reason; the items become editable again (values kept, to be saved again).
 */
export async function sendBack(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const o = await forLab(user, id, meta);
  assertFrom(o, 'result_entered', 'processing');
  await applyOrderTransition(
    o,
    'processing',
    { 'items.$[entered].status': 'pending' },
    user.id,
    `Sent back: ${reason}`.slice(0, LAB_ORDER_RULES.reasonMaxLength),
    { queryOptions: { arrayFilters: [{ 'entered.status': 'result_entered' }] } },
  );
  await record(user, AUDIT_ACTIONS.LAB_ORDER_SEND_BACK, o, meta, {
    metadata: { reasonGiven: true },
  });
  await announce(o);
  return labView(o._id);
}

/**
 * POST /lab-orders/:id/release – verified → released: the report PDF is prepared first, then one
 * transaction stores it and releases the order (a failed transaction leaves an orphaned file,
 * which is logged). The patient and the ordering doctor are notified.
 */
export async function releaseOrder(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await forLab(user, id, meta);
  assertTransition('labOrder', o.status, 'released');
  const now = new Date();
  const report = await prepareReleaseReport(await loadLabOrder(o._id, { detail: true }), {
    kind: 'release',
    releasedAt: now,
    releasedBy: `${user.firstName} ${user.lastName}`,
    createdBy: user.id,
  });
  try {
    await withTransaction(async (session) => {
      const documentId = await report.save(session);
      await applyOrderTransition(
        o,
        'released',
        { releasedAt: now, releasedBy: user.id, reportDocument: documentId },
        user.id,
        undefined,
        { session, at: now },
      );
    });
  } catch (err) {
    await report.discard(err);
    throw err;
  }
  await record(user, AUDIT_ACTIONS.LAB_ORDER_RELEASE, o, meta, {
    metadata: { reportGenerated: true },
  });
  void notifyResultsReleased(o, 'release');
  await announce(o, { patient: true });
  return labView(o._id);
}

// ---- Doctor acknowledgement --------------------------------------------------------------------

/**
 * POST /lab-orders/:id/acknowledge – a doctor who may read the order (its orderer, or with a care
 * relationship) marks the results reviewed; it leaves "results to review". Results must be there
 * (result_entered, verified or released).
 */
export async function acknowledgeResults(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await loadLabOrder(id);
  await assertCanReadLabOrder(user, o, meta);
  if (!(LAB_REVIEWABLE_STATUSES as readonly string[]).includes(o.status)) {
    throw notAllowedNow('There are no results to acknowledge yet', o.status, 'acknowledged');
  }
  const now = new Date();
  const updated = await LabOrder.updateOne(
    { _id: o._id, status: { $in: LAB_REVIEWABLE_STATUSES } },
    { $set: { reviewedByDoctorAt: now, reviewedBy: new Types.ObjectId(user.id) } },
  );
  if (updated.matchedCount === 0) {
    throw ApiError.conflict('This lab order changed meanwhile. Reload it and try again.');
  }
  await record(user, AUDIT_ACTIONS.LAB_ORDER_ACKNOWLEDGE, o, meta, {
    metadata: { status: o.status },
  });
  return toDoctorView(await loadLabOrder(o._id, { detail: true }));
}
