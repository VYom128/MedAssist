import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  FOLLOWUP_OPEN_STATUSES,
  FOLLOWUP_RULES,
  NOTIFICATION_TYPES,
  ROLES,
  SEQUENCES,
  type FollowupRequestStatus,
} from '../../config/constants.js';
import { documentListFilter } from '../../policies/documentAccess.js';
import {
  assertCanHandleFollowup,
  assertCanReadFollowup,
  followupListFilter,
} from '../../policies/followupAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { notify, type Recipient } from '../../services/notification.service.js';
import { emitFollowupUpdated } from '../../socket/emitter.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { clinicToday, endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { escapeRegex } from '../../utils/regex.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { buildPatientSearchQuery } from '../../utils/search.js';
import { assertTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { Appointment } from '../appointments/model.js';
import { Document } from '../documents/model.js';
import { findDoctor } from '../doctors/service.js';
import { Patient } from '../patients/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { FollowupRequest, type FollowupRequestDoc } from './model.js';
import {
  FOLLOWUP_LIST_POPULATE,
  FOLLOWUP_POPULATE,
  resourceOf,
  toListItem,
  toView,
  type FollowupLike,
} from './serializer.js';
import type { CreateFollowupInput, ListFollowupsQuery, PostMessageInput } from './validation.js';

/**
 * Follow-up requests (spec §4.10, §5.6, §6.18, §7.13). Every status change checks the
 * transition table (`assertTransition`) and is a conditional update on the status read, so two
 * people acting at once cannot both win. Audits and notifications name no message text (field
 * names and ids only); emails say "please log in".
 */

const FINAL: readonly FollowupRequestStatus[] = ['scheduled', 'closed', 'rejected'];

/** A request with everything the views need. 404 if missing. */
export async function loadFollowup(id: string | Types.ObjectId): Promise<FollowupLike> {
  const r = await FollowupRequest.findById(id)
    .populate([...FOLLOWUP_POPULATE])
    .lean();
  if (!r) throw ApiError.notFound('Follow-up request not found');
  return r as unknown as FollowupLike;
}

const patientIdOf = (r: FollowupLike) => r.patient._id;

// ---- Notifications and events (after the commit; never message text) -----------------------

async function receptionists(): Promise<{ id: string; email: string | null }[]> {
  const users = await User.find({ role: ROLES.RECEPTIONIST, isActive: true })
    .select('email')
    .lean();
  return users.map((u) => ({ id: u._id.toString(), email: u.email ?? null }));
}

async function patientRecipient(r: FollowupLike): Promise<Recipient | null> {
  const user = await User.findOne({ patient: patientIdOf(r), role: ROLES.PATIENT })
    .select('email')
    .lean();
  return user ? { userId: user._id.toString(), email: user.email ?? null } : null;
}

async function doctorRecipient(r: { assignedDoctor?: unknown }): Promise<Recipient | null> {
  const id = r.assignedDoctor
    ? ((r.assignedDoctor as { _id?: Types.ObjectId })._id ?? r.assignedDoctor).toString()
    : null;
  if (!id) return null;
  const user = await User.findById(id).select('email').lean();
  return user ? { userId: id, email: user.email ?? null } : null;
}

/** Tells the patient something changed on their request (no text, no type). */
async function notifyPatient(r: FollowupLike, title: string) {
  const to = await patientRecipient(r);
  if (!to) return;
  void notify({
    recipients: [to],
    type: NOTIFICATION_TYPES.FOLLOWUP_REQUEST_UPDATED,
    title,
    body: `There is an update on your request ${r.requestNumber}. Please log in to read it.`,
    link: `/patient/follow-ups/${r._id.toString()}`,
    email: true,
  });
}

/** Tells the assigned doctor and reception (no text, no type), each with their own page. */
async function notifyStaff(r: FollowupLike, kind: 'new' | 'reply') {
  const [doctor, desk] = await Promise.all([doctorRecipient(r), receptionists()]);
  const id = r._id.toString();
  const message = {
    type:
      kind === 'new'
        ? NOTIFICATION_TYPES.FOLLOWUP_REQUEST_NEW
        : NOTIFICATION_TYPES.FOLLOWUP_REQUEST_REPLY,
    title: kind === 'new' ? 'New follow-up request' : 'New reply on a follow-up request',
    body:
      kind === 'new'
        ? `Follow-up request ${r.requestNumber} is waiting. Please log in to read it.`
        : `You have a new reply on ${r.requestNumber}. Please log in to read it.`,
    email: true,
  };
  if (doctor) void notify({ ...message, recipients: [doctor], link: `/doctor/follow-ups/${id}` });
  if (desk.length > 0) {
    void notify({
      ...message,
      recipients: desk.map((d) => ({ userId: d.id, email: d.email })),
      link: `/reception/follow-ups/${id}`,
    });
  }
}

/**
 * `followup.updated` (ids only) to the assigned doctor(s), reception (role room) and – when the
 * change is visible to them – the patient.
 */
async function announce(
  r: FollowupLike,
  { patient = true, doctors = [] }: { patient?: boolean; doctors?: (string | null)[] } = {},
) {
  const userIds = new Set<string>();
  const assigned = r.assignedDoctor?._id.toString();
  if (assigned) userIds.add(assigned);
  for (const d of doctors) if (d) userIds.add(d);
  if (patient) {
    const p = await patientRecipient(r);
    if (p?.userId) userIds.add(p.userId);
  }
  emitFollowupUpdated(r._id.toString(), [...userIds]);
}

// ---- Create (patient) ------------------------------------------------------------------------

const limitReached = (message: string, details: Record<string, unknown>) =>
  new ApiError(422, message, ERROR_CODES.FOLLOWUP_LIMIT_REACHED, details);

/**
 * The patient's related visit (own appointment, else 422) – its doctor is assigned.
 */
async function relatedAppointment(patientId: string, appointmentId?: string) {
  if (!appointmentId) return null;
  const appt = await Appointment.findOne({ _id: appointmentId, patient: patientId })
    .select('doctor')
    .lean();
  if (!appt) {
    throw ApiError.unprocessable('Choose one of your own visits', [
      { field: 'body.relatedAppointmentId', message: 'Not one of your visits' },
    ]);
  }
  return appt;
}

/** The attachments must be the patient's own documents (visible to them, not deleted). */
async function assertOwnDocuments(user: AuthUser, ids: string[]) {
  if (ids.length === 0) return [];
  const allowed = await documentListFilter(user);
  const found = await Document.find({ $and: [allowed, { _id: { $in: ids } }] })
    .select('_id')
    .lean();
  if (found.length !== ids.length) {
    throw ApiError.unprocessable('Attach only your own documents', [
      { field: 'body.attachmentIds', message: 'Not one of your documents' },
    ]);
  }
  return found.map((d) => d._id);
}

/**
 * POST /follow-up-requests (patient, linked) – at most 3 open requests and 5 new per clinic day
 * (422 FOLLOWUP_LIMIT_REACHED), counted inside a transaction that first bumps the patient's
 * `bookingVersion`, so parallel requests cannot pass the limits together. The related visit's
 * doctor is assigned. Audited `followup.create` (type and counts, never the message).
 */
export async function createFollowup(
  user: AuthUser,
  input: CreateFollowupInput,
  meta: RequestMeta,
) {
  const patientId = await resolveMyPatientId(user);
  const appt = await relatedAppointment(patientId, input.relatedAppointmentId);
  const attachments = await assertOwnDocuments(user, input.attachmentIds ?? []);
  const { timezone } = await getSettings();
  const now = new Date();
  const today = clinicToday(timezone, now);
  const patient = new Types.ObjectId(patientId);

  const created = await withTransaction(async (session) => {
    await Patient.updateOne({ _id: patient }, { $inc: { bookingVersion: 1 } }, { session });
    const [open, todays] = await Promise.all([
      FollowupRequest.countDocuments({ patient, status: { $in: FOLLOWUP_OPEN_STATUSES } }).session(
        session,
      ),
      FollowupRequest.countDocuments({
        patient,
        createdAt: { $gte: startOfClinicDay(today, timezone) },
      }).session(session),
    ]);
    if (open >= FOLLOWUP_RULES.maxOpenPerPatient) {
      throw limitReached(
        `You already have ${open} open requests. Please wait for a reply, or close one first.`,
        { limit: FOLLOWUP_RULES.maxOpenPerPatient, kind: 'open' },
      );
    }
    if (todays >= FOLLOWUP_RULES.maxNewPerDay) {
      throw limitReached('You have sent the most requests allowed today. Please try tomorrow.', {
        limit: FOLLOWUP_RULES.maxNewPerDay,
        kind: 'daily',
      });
    }
    const year = Number(today.slice(0, 4));
    const seq = await nextSequence(`${SEQUENCES.FOLLOWUP_REQUEST.key}:${year}`, { session });
    const [doc] = await FollowupRequest.create(
      [
        {
          requestNumber: formatNumber(SEQUENCES.FOLLOWUP_REQUEST.prefix, seq, { year }),
          patient,
          relatedAppointment: appt?._id,
          assignedDoctor: appt?.doctor,
          type: input.type,
          message: input.message,
          preferredDate: input.preferredDate,
          attachments,
          status: 'open',
          statusHistory: [{ status: 'open', at: now, by: user.id }],
          createdBy: user.id,
        },
      ],
      { session },
    );
    if (attachments.length > 0) {
      await Document.updateMany(
        { _id: { $in: attachments }, 'linked.type': { $exists: false } },
        { $set: { linked: { type: 'followup_request', id: doc!._id } } },
        { session },
      );
    }
    return doc!;
  });

  await audit.record({
    action: AUDIT_ACTIONS.FOLLOWUP_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient,
    request: meta,
    metadata: {
      type: created.type,
      relatedAppointment: appt?._id.toString() ?? null,
      assignedDoctor: appt?.doctor.toString() ?? null,
      attachments: attachments.length,
    },
  });
  const r = await loadFollowup(created._id);
  await notifyStaff(r, 'new');
  await announce(r);
  return toView(r, user.role);
}

// ---- Reads -----------------------------------------------------------------------------------

/**
 * GET /follow-up-requests – reception/admins every request (filters), doctors those assigned to
 * them, patients their own; newest first. Rows have no message text.
 */
export async function listFollowups(
  user: AuthUser,
  query: ListFollowupsQuery,
  { page, limit, skip }: Pagination,
) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const and: FilterQuery<FollowupRequestDoc>[] = [followupListFilter(user)];
  if (query.status) and.push({ status: { $in: query.status } });
  if (query.type) and.push({ type: query.type });
  if (query.assignedDoctor) and.push({ assignedDoctor: new Types.ObjectId(query.assignedDoctor) });
  if (query.from || query.to) {
    const { timezone } = await getSettings();
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfClinicDay(query.from, timezone);
    if (query.to) range.$lte = endOfClinicDay(query.to, timezone);
    and.push({ createdAt: range });
  }
  if (query.q && user.role !== ROLES.PATIENT) {
    const byNumber = /^FUR-\d{4}-\d{1,6}$/i.test(query.q)
      ? { requestNumber: new RegExp(`^${escapeRegex(query.q.toUpperCase())}$`) }
      : null;
    const search = buildPatientSearchQuery(query.q);
    const patients = search ? await Patient.find(search).select('_id').limit(200).lean() : [];
    and.push({
      $or: [...(byNumber ? [byNumber] : []), { patient: { $in: patients.map((p) => p._id) } }],
    });
  }
  const filter = { $and: and };
  const [rows, total] = await Promise.all([
    FollowupRequest.find(filter)
      .select('-message -messages.text')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate([...FOLLOWUP_LIST_POPULATE])
      .lean(),
    FollowupRequest.countDocuments(filter),
  ]);
  return {
    items: (rows as unknown as FollowupLike[]).map((r) => toListItem(r, user.role)),
    meta: buildMeta({ page, limit, total }),
  };
}

/** GET /follow-up-requests/:id – audited `followup.view` (debounced, no text). */
export async function getFollowup(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const r = await loadFollowup(id);
  await assertCanReadFollowup(user, r, meta);
  await audit.recordRead({
    action: AUDIT_ACTIONS.FOLLOWUP_VIEW,
    actor: actorOf(user),
    resource: resourceOf(r),
    patient: patientIdOf(r),
    request: meta,
  });
  return toView(r, user.role);
}

// ---- Status changes ---------------------------------------------------------------------------

/**
 * Moves `r` from the status it was read in to `to` (checked against the transition table) with
 * extra `$set`/`$push`, conditional on the status – a concurrent change → 409 CONFLICT. Pass
 * `session` to run it inside another transaction (scheduling books in the same commit).
 */
export async function transitionFollowup(
  r: FollowupLike,
  to: FollowupRequestStatus,
  by: string,
  {
    note,
    set = {},
    push = {},
    session,
    now = new Date(),
  }: {
    note?: string;
    set?: Record<string, unknown>;
    push?: Record<string, unknown>;
    session?: ClientSession;
    now?: Date;
  } = {},
) {
  assertTransition('followupRequest', r.status, to);
  const updated = await FollowupRequest.findOneAndUpdate(
    { _id: r._id, status: r.status },
    {
      $set: { ...set, status: to },
      $push: { ...push, statusHistory: { status: to, at: now, by, ...(note ? { note } : {}) } },
    },
    { new: true, session, runValidators: true },
  ).lean();
  if (!updated) {
    throw ApiError.conflict('This request was changed at the same time. Reload it and try again.');
  }
  return updated;
}

/** A 409 for actions on a request that is already finished. */
function assertNotFinal(r: FollowupLike) {
  if ((FINAL as readonly string[]).includes(r.status)) {
    assertTransition('followupRequest', r.status, 'open'); // throws INVALID_STATUS_TRANSITION
  }
}

/**
 * POST /follow-up-requests/:id/messages – a threaded reply.
 * - patient (own): visibility 'all' only; a reply to a 'responded' request reopens it ('open');
 * - staff (reception, assigned doctor): 'all' → 'responded' (from open / in_review); 'staff' is
 *   an internal note and changes nothing.
 * Nobody posts on a scheduled, closed or rejected request (409). Audited `followup.message` with
 * the visibility and status change only.
 */
export async function postMessage(
  user: AuthUser,
  id: string,
  input: PostMessageInput,
  meta: RequestMeta,
) {
  const isPatient = user.role === ROLES.PATIENT;
  if (isPatient) await resolveMyPatientId(user);
  const r = await loadFollowup(id);
  if (isPatient) await assertCanReadFollowup(user, r, meta);
  else await assertCanHandleFollowup(user, r, meta);
  if (isPatient && input.visibility !== 'all') {
    throw ApiError.unprocessable('Patients cannot add internal notes', [
      { field: 'body.visibility', message: 'Must be all' },
    ]);
  }
  const internal = input.visibility === 'staff';
  if (!internal) assertNotFinal(r);

  const now = new Date();
  const message = {
    from: user.id,
    role: user.role,
    text: input.text,
    visibility: input.visibility,
    at: now,
  };
  let to: FollowupRequestStatus | null = null;
  if (isPatient && r.status === 'responded') to = 'open';
  if (!isPatient && !internal && (r.status === 'open' || r.status === 'in_review')) {
    to = 'responded';
  }
  if (to) {
    await transitionFollowup(r, to, user.id, { push: { messages: message }, now });
  } else {
    const updated = await FollowupRequest.updateOne(
      { _id: r._id, status: r.status },
      { $push: { messages: message } },
      { runValidators: true },
    );
    if (updated.modifiedCount === 0) {
      throw ApiError.conflict(
        'This request was changed at the same time. Reload it and try again.',
      );
    }
  }

  await audit.record({
    action: AUDIT_ACTIONS.FOLLOWUP_MESSAGE,
    actor: actorOf(user),
    resource: resourceOf(r),
    patient: patientIdOf(r),
    request: meta,
    changes: { fields: ['messages'] },
    metadata: { visibility: input.visibility, from: r.status, to: to ?? r.status },
  });
  const fresh = await loadFollowup(r._id);
  if (isPatient) await notifyStaff(fresh, 'reply');
  else if (!internal) await notifyPatient(fresh, 'New reply to your request');
  await announce(fresh, { patient: !internal });
  return toView(fresh, user.role);
}

/** POST /follow-up-requests/:id/review – reception or the assigned doctor: open → in_review. */
export async function reviewFollowup(user: AuthUser, id: string, meta: RequestMeta) {
  const r = await loadFollowup(id);
  await assertCanHandleFollowup(user, r, meta);
  await transitionFollowup(r, 'in_review', user.id);
  await audit.record({
    action: AUDIT_ACTIONS.FOLLOWUP_REVIEW,
    actor: actorOf(user),
    resource: resourceOf(r),
    patient: patientIdOf(r),
    request: meta,
    metadata: { from: r.status, to: 'in_review' },
  });
  const fresh = await loadFollowup(r._id);
  await announce(fresh);
  return toView(fresh, user.role);
}

/**
 * POST /follow-up-requests/:id/assign – reception (re)assigns an active doctor (also on an
 * unassigned request); not on finished requests (409). The new doctor gains a care relationship.
 */
export async function assignFollowup(
  user: AuthUser,
  id: string,
  doctorId: string,
  meta: RequestMeta,
) {
  const r = await loadFollowup(id);
  await assertCanHandleFollowup(user, r, meta);
  assertNotFinal(r);
  const doctor = await findDoctor(doctorId).catch(() => null);
  if (!doctor || doctor.user.isActive === false) {
    throw ApiError.unprocessable('Choose an active doctor', [
      { field: 'body.doctorId', message: 'Not an active doctor' },
    ]);
  }
  const previous = r.assignedDoctor?._id.toString() ?? null;
  const updated = await FollowupRequest.updateOne(
    { _id: r._id, status: r.status },
    { $set: { assignedDoctor: doctor.user._id } },
  );
  if (updated.matchedCount === 0) {
    throw ApiError.conflict('This request was changed at the same time. Reload it and try again.');
  }
  await audit.record({
    action: AUDIT_ACTIONS.FOLLOWUP_ASSIGN,
    actor: actorOf(user),
    resource: resourceOf(r),
    patient: patientIdOf(r),
    request: meta,
    changes: {
      fields: ['assignedDoctor'],
      before: { assignedDoctor: previous },
      after: { assignedDoctor: doctor.user._id.toString() },
    },
  });
  const fresh = await loadFollowup(r._id);
  const to = await doctorRecipient(fresh);
  if (to && to.userId !== previous) {
    void notify({
      recipients: [to],
      type: NOTIFICATION_TYPES.FOLLOWUP_REQUEST_NEW,
      title: 'Follow-up request assigned to you',
      body: `Follow-up request ${fresh.requestNumber} was assigned to you. Please log in to read it.`,
      link: `/doctor/follow-ups/${fresh._id.toString()}`,
      email: true,
    });
  }
  await announce(fresh, { patient: false, doctors: [previous] });
  return toView(fresh, user.role);
}

/**
 * POST /follow-up-requests/:id/close – reception, the assigned doctor, or the patient (own);
 * /reject – staff only. With a reason; from open, in_review or responded.
 */
export async function finishFollowup(
  user: AuthUser,
  id: string,
  outcome: 'closed' | 'rejected',
  reason: string,
  meta: RequestMeta,
) {
  const isPatient = user.role === ROLES.PATIENT;
  if (isPatient) await resolveMyPatientId(user);
  const r = await loadFollowup(id);
  if (isPatient) await assertCanReadFollowup(user, r, meta);
  else await assertCanHandleFollowup(user, r, meta);
  await transitionFollowup(r, outcome, user.id, { note: reason, set: { closedReason: reason } });
  await audit.record({
    action: outcome === 'closed' ? AUDIT_ACTIONS.FOLLOWUP_CLOSE : AUDIT_ACTIONS.FOLLOWUP_REJECT,
    actor: actorOf(user),
    resource: resourceOf(r),
    patient: patientIdOf(r),
    request: meta,
    changes: { fields: ['status', 'closedReason'] },
    metadata: { from: r.status, to: outcome },
  });
  const fresh = await loadFollowup(r._id);
  if (!isPatient) {
    await notifyPatient(
      fresh,
      outcome === 'closed' ? 'Your request was closed' : 'Your request could not be accepted',
    );
  }
  await announce(fresh);
  return toView(fresh, user.role);
}
