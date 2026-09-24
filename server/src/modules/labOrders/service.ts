import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  LAB_ITEM_CANCELLABLE_IN,
  LAB_ORDER_DOCTOR_CANCELLABLE,
  LAB_REVIEWABLE_STATUSES,
  ROLES,
  SEQUENCES,
} from '../../config/constants.js';
import { assertCanWriteEncounter } from '../../policies/encounterAccess.js';
import {
  assertCanCancelItem,
  assertCanReadLabOrder,
  assertOrderingDoctor,
} from '../../policies/labOrderAccess.js';
import {
  assertCanAccessPatient,
  PLACED_LAB_ORDER,
  relatedPatientIds,
} from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { emitLabOrderChanged, emitLabWorklistUpdated } from '../../socket/emitter.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { clinicToday, endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { buildPatientSearchQuery } from '../../utils/search.js';
import { withTransaction } from '../../utils/transaction.js';
import { assertDocumentationOpen, loadEncounter } from '../encounters/service.js';
import { LabTest } from '../labTests/model.js';
import { Patient } from '../patients/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { LabOrder, type LabOrderDoc } from './model.js';
import {
  LAB_ORDER_DETAIL_POPULATE,
  LAB_ORDER_POPULATE,
  toDoctorView,
  toLabView,
  toListItem,
  toPatientView,
  toReceptionView,
  type LabOrderLike,
} from './serializer.js';
import { applyOrderTransition, historyEntry, recomputeOrderStatus } from './status.service.js';
import type { CreateLabOrderInput, ListLabOrdersQuery, UpdateLabOrderInput } from './validation.js';

export const resourceOf = (o: { _id: Types.ObjectId; orderNumber?: string | null }) => ({
  type: 'lab_order',
  id: o._id,
  ...(o.orderNumber ? { number: o.orderNumber } : {}),
});

export const patientIdOf = (o: { patient: Types.ObjectId | { _id: Types.ObjectId } }) =>
  '_id' in o.patient ? o.patient._id : o.patient;

/** A lab order with doctor and patient populated (`detail`: also the lab staff). 404 if none. */
export async function loadLabOrder(
  id: string | Types.ObjectId,
  { detail = false, session }: { detail?: boolean; session?: ClientSession } = {},
): Promise<LabOrderLike> {
  const o = await LabOrder.findById(id)
    .populate(detail ? [...LAB_ORDER_DETAIL_POPULATE] : [...LAB_ORDER_POPULATE])
    .session(session ?? null)
    .lean();
  if (!o) throw ApiError.notFound('Lab order not found');
  return o as unknown as LabOrderLike;
}

/** The detail view for the caller's role. */
export function viewForRole(user: AuthUser, o: LabOrderLike) {
  switch (user.role) {
    case ROLES.LABTECH:
      return toLabView(o);
    case ROLES.DOCTOR:
      return toDoctorView(o);
    case ROLES.PATIENT:
      return toPatientView(o);
    default:
      return toReceptionView(o);
  }
}

/** Loads the order's detail view for `user` (after a change). */
export async function freshView(user: AuthUser, id: Types.ObjectId | string) {
  return viewForRole(user, await loadLabOrder(id, { detail: true }));
}

// ---- Numbers and items -----------------------------------------------------------------------

/** LAB-<clinic year>-000001 from the counter, inside the caller's transaction (spec §8.10). */
async function nextOrderNumber(session: ClientSession, now: Date) {
  const { timezone } = await getSettings();
  const year = Number(clinicToday(timezone, now).slice(0, 4));
  const seq = await nextSequence(`${SEQUENCES.LAB_ORDER.key}:${year}`, { session });
  return formatNumber(SEQUENCES.LAB_ORDER.prefix, seq, { year });
}

/**
 * Items for the given catalogue tests, in the order given, snapshotting code, name, price,
 * sample type and turnaround time. Every test must be active → else 422 with the positions.
 */
async function itemsFor(testIds: readonly string[]) {
  const tests = await LabTest.find({ _id: { $in: testIds }, isActive: true }).lean();
  const byId = new Map(tests.map((t) => [t._id.toString(), t]));
  const missing = testIds.flatMap((id, i) =>
    byId.has(id) ? [] : [{ field: `body.testIds.${i}`, message: 'Not an active lab test' }],
  );
  if (missing.length > 0) {
    throw ApiError.unprocessable('Some of these tests cannot be ordered', missing);
  }
  return testIds.map((id) => {
    const t = byId.get(id)!;
    return {
      test: t._id,
      testSnapshot: {
        code: t.code,
        name: t.name,
        pricePaise: t.pricePaise,
        sampleType: t.sampleType,
        ...(t.turnaroundHours ? { turnaroundHours: t.turnaroundHours } : {}),
      },
      status: 'pending' as const,
    };
  });
}

const draftOnly = () =>
  new ApiError(
    409,
    'Only a draft order can be changed. Cancel single tests or the whole order instead.',
    ERROR_CODES.RECORD_LOCKED,
  );

// ---- Ordering (spec §7.14, §4.7) ------------------------------------------------------------

/**
 * POST /lab-orders – the doctor's own note, within the documentation window (else 422
 * DOCUMENTATION_WINDOW_CLOSED). On a draft note the order is a draft (placed when the note is
 * signed); on a signed or amended note it is placed at once (number, `orderedAt`).
 */
export async function createLabOrder(
  user: AuthUser,
  input: CreateLabOrderInput,
  meta: RequestMeta,
) {
  const e = await loadEncounter(input.encounterId);
  await assertCanWriteEncounter(user, e, meta);
  await assertDocumentationOpen(e.appointment);
  const items = await itemsFor(input.testIds);
  const place = e.status !== 'draft';
  const now = new Date();

  const created = await withTransaction(async (session) => {
    const orderNumber = place ? await nextOrderNumber(session, now) : null;
    const status = place ? 'ordered' : 'draft';
    const [doc] = await LabOrder.create(
      [
        {
          patient: e.patient._id,
          orderedBy: user.id,
          encounter: e._id,
          appointment: e.appointment,
          priority: input.priority,
          ...(input.clinicalNotes ? { clinicalNotes: input.clinicalNotes } : {}),
          status,
          ...(orderNumber ? { orderNumber, orderedAt: now } : {}),
          items,
          statusHistory: [historyEntry(status, user.id, undefined, now)],
          createdBy: user.id,
          updatedBy: user.id,
        },
      ],
      { session },
    );
    return doc!;
  });

  await audit.record({
    action: AUDIT_ACTIONS.LAB_ORDER_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: created.patient,
    request: meta,
    metadata: {
      status: created.status,
      testCount: items.length,
      priority: created.priority,
      clinicalNotesGiven: Boolean(input.clinicalNotes),
    },
  });
  if (place) emitLabWorklistUpdated([created._id.toString()]);
  return toDoctorView(await loadLabOrder(created._id, { detail: true }));
}

/** PATCH /lab-orders/:id – the ordering doctor changes a draft's tests, priority or notes. */
export async function updateDraftOrder(
  user: AuthUser,
  id: string,
  input: UpdateLabOrderInput,
  meta: RequestMeta,
) {
  const o = await loadLabOrder(id);
  await assertOrderingDoctor(user, o, meta);
  if (o.status !== 'draft') throw draftOnly();
  await assertDocumentationOpen(o.appointment);
  const set: Record<string, unknown> = { updatedBy: user.id };
  if (input.testIds) set.items = await itemsFor(input.testIds);
  if (input.priority) set.priority = input.priority;
  if (input.clinicalNotes) set.clinicalNotes = input.clinicalNotes;
  const updated = await LabOrder.findOneAndUpdate(
    { _id: o._id, status: 'draft' },
    {
      $set: set,
      ...(input.clinicalNotes === null ? { $unset: { clinicalNotes: '' } } : {}),
      $inc: { __v: 1 },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw draftOnly();
  await audit.record({
    action: AUDIT_ACTIONS.LAB_ORDER_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
    changes: { fields: Object.keys(input) },
    metadata: { testCount: updated.items.length },
  });
  return freshView(user, o._id);
}

/** POST /lab-orders/:id/discard – a draft the doctor no longer wants → cancelled. */
export async function discardDraftOrder(user: AuthUser, id: string, meta: RequestMeta) {
  const o = await loadLabOrder(id);
  await assertOrderingDoctor(user, o, meta);
  if (o.status !== 'draft') {
    throw new ApiError(
      409,
      'Only a draft order can be discarded. Cancel a placed order instead.',
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from: o.status, to: 'cancelled' },
    );
  }
  const now = new Date();
  await applyOrderTransition(
    o,
    'cancelled',
    { cancellation: { by: user.id, at: now, reason: 'Draft discarded' } },
    user.id,
    'Draft discarded',
    { at: now },
  );
  await audit.record({
    action: AUDIT_ACTIONS.LAB_ORDER_DISCARD,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
  });
  return freshView(user, o._id);
}

/**
 * Places the note's draft orders inside the signing transaction (spec §4.7 step 5): each gets
 * its number and `orderedAt`, draft → ordered. Conditional on status, so a draft discarded
 * meanwhile is skipped. @returns the placed orders (audit and events after the commit).
 */
export async function submitDraftOrdersInSession(
  encounterId: Types.ObjectId,
  { by, session, now = new Date() }: { by: string; session: ClientSession; now?: Date },
) {
  const drafts = await LabOrder.find({ encounter: encounterId, status: 'draft' })
    .select('_id status patient')
    .session(session)
    .lean();
  const placed: { _id: Types.ObjectId; orderNumber: string; patient: Types.ObjectId }[] = [];
  for (const d of drafts) {
    const orderNumber = await nextOrderNumber(session, now);
    await applyOrderTransition(d, 'ordered', { orderNumber, orderedAt: now }, by, 'Note signed', {
      session,
      at: now,
    });
    placed.push({ _id: d._id, orderNumber, patient: d.patient });
  }
  return placed;
}

/** After the signing transaction: audit each placed order, tell the lab. */
export async function afterDraftsSubmitted(
  user: AuthUser,
  placed: Awaited<ReturnType<typeof submitDraftOrdersInSession>>,
  meta: RequestMeta,
) {
  for (const o of placed) {
    await audit.record({
      action: AUDIT_ACTIONS.LAB_ORDER_SUBMIT,
      actor: actorOf(user),
      resource: resourceOf(o),
      patient: o.patient,
      request: meta,
      metadata: { via: 'sign' },
    });
  }
  emitLabWorklistUpdated(placed.map((o) => o._id.toString()));
}

// ---- Cancelling ------------------------------------------------------------------------------

/**
 * POST /lab-orders/:id/cancel – the ordering doctor, before a sample is held (ordered or
 * sample_rejected). After collection, single tests can still be cancelled until they have
 * results.
 */
export async function cancelLabOrder(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const o = await loadLabOrder(id);
  await assertOrderingDoctor(user, o, meta);
  if (o.status === 'draft') {
    throw new ApiError(
      409,
      'This order is a draft: discard it instead.',
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from: o.status, to: 'cancelled' },
    );
  }
  if (!(LAB_ORDER_DOCTOR_CANCELLABLE as readonly string[]).includes(o.status)) {
    throw new ApiError(
      409,
      o.status === 'sample_collected' || o.status === 'processing'
        ? 'The sample has been collected: cancel single tests that have no results instead.'
        : `This lab order is ${o.status.replace(/_/g, ' ')} and cannot be cancelled`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from: o.status, to: 'cancelled' },
    );
  }
  const now = new Date();
  await applyOrderTransition(
    o,
    'cancelled',
    { cancellation: { by: user.id, at: now, reason } },
    user.id,
    'Cancelled by the ordering doctor',
    { at: now },
  );
  await audit.record({
    action: AUDIT_ACTIONS.LAB_ORDER_CANCEL,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
    metadata: { reasonGiven: true, from: o.status },
  });
  emitLabWorklistUpdated([o._id.toString()]);
  return freshView(user, o._id);
}

/**
 * POST /lab-orders/:id/items/:itemId/cancel – a lab technician or the ordering doctor cancels one
 * test that has no results yet (e.g. reagent unavailable), with a reason. The order status is
 * re-derived in the same transaction: all tests cancelled → cancelled; the others all entered →
 * result_entered.
 */
export async function cancelLabOrderItem(
  user: AuthUser,
  id: string,
  itemId: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const o = await loadLabOrder(id);
  await assertCanCancelItem(user, o, meta);
  const item = o.items.find((i) => i._id.toString() === itemId);
  if (!item) throw ApiError.notFound('Test not found in this order');
  if (o.status === 'draft') throw draftOnly();
  if (!(LAB_ITEM_CANCELLABLE_IN as readonly string[]).includes(o.status)) {
    throw new ApiError(
      409,
      `This lab order is ${o.status.replace(/_/g, ' ')}: its tests can no longer be cancelled`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from: o.status, to: 'cancelled' },
    );
  }
  if (item.status !== 'pending') {
    throw new ApiError(
      409,
      item.status === 'cancelled'
        ? 'This test is already cancelled'
        : 'This test already has results and cannot be cancelled',
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from: item.status, to: 'cancelled' },
    );
  }

  const itemOid = new Types.ObjectId(itemId);
  const now = new Date();
  const status = await withTransaction(async (session) => {
    const updated = await LabOrder.updateOne(
      {
        _id: o._id,
        status: { $in: LAB_ITEM_CANCELLABLE_IN },
        items: { $elemMatch: { _id: itemOid, status: 'pending' } },
      },
      {
        $set: {
          'items.$[it].status': 'cancelled',
          'items.$[it].cancellation': { by: user.id, at: now, reason },
          updatedBy: user.id,
        },
        $inc: { __v: 1 },
      },
      { arrayFilters: [{ 'it._id': itemOid }], session },
    );
    if (updated.modifiedCount === 0) {
      throw ApiError.conflict('This lab order changed meanwhile. Reload it and try again.');
    }
    return recomputeOrderStatus(o._id, { by: user.id, session, note: 'All tests cancelled' });
  });

  await audit.record({
    action: AUDIT_ACTIONS.LAB_ORDER_ITEM_CANCEL,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
    metadata: { itemId, reasonGiven: true, orderStatus: status },
  });
  emitLabWorklistUpdated([o._id.toString()]);
  emitLabOrderChanged(o._id.toString(), [o.orderedBy._id.toString()]);
  return freshView(user, o._id);
}

// ---- Reads -----------------------------------------------------------------------------------

/**
 * GET /lab-orders/:id – scoped per role (policies/labOrderAccess); audited `lab_order.view`,
 * debounced 5 min per user + order.
 */
export async function getLabOrder(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user); // 403 while the link is pending
  const o = await loadLabOrder(id, { detail: true });
  await assertCanReadLabOrder(user, o, meta);
  await audit.recordRead({
    action: AUDIT_ACTIONS.LAB_ORDER_VIEW,
    actor: actorOf(user),
    resource: resourceOf(o),
    patient: patientIdOf(o),
    request: meta,
  });
  return viewForRole(user, o);
}

type Filter = FilterQuery<LabOrderDoc>;

/** The base filter per role for GET /lab-orders (after the patient checks). */
async function roleFilter(user: AuthUser, query: ListLabOrdersQuery, meta: RequestMeta) {
  switch (user.role) {
    case ROLES.LABTECH:
      return PLACED_LAB_ORDER as Filter;
    case ROLES.DOCTOR: {
      const me = new Types.ObjectId(user.id);
      // Their drafts and every placed order – but not drafts they discarded.
      const visible: Filter = { $or: [PLACED_LAB_ORDER, { status: 'draft' }] };
      if (query.needsReview) {
        return {
          orderedBy: me,
          status: { $in: LAB_REVIEWABLE_STATUSES },
          reviewedByDoctorAt: null,
        } as Filter;
      }
      if (query.patient) {
        await assertCanAccessPatient(user, query.patient, 'lab', meta);
        return { $and: [visible, { $or: [{ orderedBy: me }, PLACED_LAB_ORDER] }] } as Filter;
      }
      const related = await relatedPatientIds(user.id);
      return {
        $and: [
          visible,
          { $or: [{ orderedBy: me }, { ...PLACED_LAB_ORDER, patient: { $in: related } }] },
        ],
      } as Filter;
    }
    case ROLES.RECEPTIONIST: {
      if (!query.patient && !query.appointment) {
        throw ApiError.validation('Choose a patient or an appointment', [
          { field: 'query.patient', message: 'Choose a patient or an appointment' },
        ]);
      }
      if (query.patient) await assertCanAccessPatient(user, query.patient, 'demographics', meta);
      return PLACED_LAB_ORDER as Filter;
    }
    case ROLES.PATIENT: {
      const own = await resolveMyPatientId(user);
      return { patient: new Types.ObjectId(own), status: 'released' } as Filter;
    }
    default:
      return { _id: { $in: [] } } as Filter;
  }
}

/**
 * `q` on the worklist: an order number or sample id (exact), else a patient's MRN, phone or
 * name (patient search rules, D70). Never a regex built from the raw text.
 */
async function searchFilter(q: string): Promise<Filter> {
  const term = q.trim().toUpperCase();
  if (/^LAB-\d{4}-\d{1,9}$/.test(term)) return { orderNumber: term };
  if (/^S\d{2}-\d{1,9}$/.test(term)) return { 'sample.sampleId': term };
  const patientQuery = buildPatientSearchQuery(q);
  if (!patientQuery) return {};
  const patients = await Patient.find(patientQuery).select('_id').limit(200).lean();
  return { patient: { $in: patients.map((p) => p._id) } };
}

/**
 * GET /lab-orders – lab technicians: the worklist (every placed order; urgent first, then
 * oldest); doctors: their own orders and placed orders of related patients (`needsReview`: own
 * orders with results not yet acknowledged); receptionists: status only, for one patient or
 * appointment; patients: their own released orders.
 */
export async function listLabOrders(
  user: AuthUser,
  query: ListLabOrdersQuery,
  { page, limit, skip }: Pagination,
  meta: RequestMeta,
) {
  const and: Filter[] = [await roleFilter(user, query, meta)];
  if (query.patient) and.push({ patient: new Types.ObjectId(query.patient) });
  if (query.appointment) and.push({ appointment: new Types.ObjectId(query.appointment) });
  if (query.encounter) and.push({ encounter: new Types.ObjectId(query.encounter) });
  if (query.status) and.push({ status: { $in: query.status } });
  if (query.priority) and.push({ priority: query.priority });
  if (query.q && user.role !== ROLES.PATIENT) and.push(await searchFilter(query.q));
  if (query.from || query.to) {
    const { timezone } = await getSettings();
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfClinicDay(query.from, timezone);
    if (query.to) range.$lte = endOfClinicDay(query.to, timezone);
    and.push({ orderedAt: range });
  }
  const filter = { $and: and };
  const sort: Record<string, 1 | -1> =
    user.role === ROLES.LABTECH
      ? { priority: -1, orderedAt: 1, _id: 1 }
      : user.role === ROLES.PATIENT
        ? { releasedAt: -1, _id: -1 }
        : { orderedAt: -1, createdAt: -1, _id: -1 };
  const [items, total] = await Promise.all([
    LabOrder.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate([...LAB_ORDER_POPULATE])
      .lean(),
    LabOrder.countDocuments(filter),
  ]);
  return {
    items: (items as unknown as LabOrderLike[]).map((o) => toListItem(o, user.role)),
    meta: buildMeta({ page, limit, total }),
  };
}
