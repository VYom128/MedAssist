import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  ROLES,
  SEQUENCES,
} from '../../config/constants.js';
import { assertCanWriteEncounter } from '../../policies/encounterAccess.js';
import { assertCanAccessPatient, relatedPatientIds } from '../../policies/patientAccess.js';
import {
  assertCanReadPrescription,
  assertCanWritePrescription,
  ISSUED_STATUSES,
} from '../../policies/prescriptionAccess.js';
import { checkAllergies, drugComponents, drugKey } from '../../services/allergyCheck.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { notify } from '../../services/notification.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { clinicToday, endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { assertDocumentationOpen, loadEncounter } from '../encounters/service.js';
import { Patient } from '../patients/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { Prescription, type PrescriptionDoc, type PrescriptionItem } from './model.js';
import {
  allergyWarningsOf,
  PRESCRIPTION_POPULATE,
  toDoctorView,
  toListItem,
  toPatientView,
  toPrintView,
  type PrescriptionLike,
} from './serializer.js';
import type {
  ListPrescriptionsQuery,
  PrescriptionItemInput,
  PutPrescriptionInput,
} from './validation.js';

export const resourceOf = (p: { _id: Types.ObjectId; prescriptionNumber?: string | null }) => ({
  type: 'prescription',
  id: p._id,
  ...(p.prescriptionNumber ? { number: p.prescriptionNumber } : {}),
});

const patientIdOf = (p: PrescriptionLike) => p.patient._id;

/** A prescription with doctor and patient populated. 404 if missing. */
export async function loadPrescription(
  id: string | Types.ObjectId,
  session?: ClientSession,
): Promise<PrescriptionLike> {
  const p = await Prescription.findById(id)
    .populate([...PRESCRIPTION_POPULATE])
    .session(session ?? null)
    .lean();
  if (!p) throw ApiError.notFound('Prescription not found');
  return p as unknown as PrescriptionLike;
}

/** The view for the caller's role (reception gets the print view). */
export function viewForRole(user: AuthUser, p: PrescriptionLike) {
  switch (user.role) {
    case ROLES.DOCTOR:
      return toDoctorView(p);
    case ROLES.PATIENT:
      return toPatientView(p);
    default:
      return toPrintView(p);
  }
}

// ---- Errors ----------------------------------------------------------------------------------

const lockedPrescription = () =>
  new ApiError(
    409,
    'This prescription has been issued and cannot be changed. Cancel it or reissue it instead.',
    ERROR_CODES.RECORD_LOCKED,
  );

const staleRevision = (current: number) =>
  ApiError.conflict(
    'This prescription was changed in another tab or window. Reload it to see the latest version.',
    { currentRevision: current },
  );

const isDuplicateKey = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

// ---- Issue checks (spec §8.6) ----------------------------------------------------------------

export interface FieldProblem {
  field: string;
  message: string;
}

/**
 * What an item list lacks to be issued: every item needs a dose, a frequency (text for
 * 'other') and a duration. `prefix` is prepended to field paths ('prescription.').
 */
export function issueProblems(
  items: readonly Partial<PrescriptionItem>[],
  prefix = '',
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  items.forEach((item, i) => {
    const at = (f: string) => `${prefix}items.${i}.${f}`;
    if (!item.dose) problems.push({ field: at('dose'), message: 'Dose is required' });
    if (!item.frequency)
      problems.push({ field: at('frequency'), message: 'Frequency is required' });
    else if (item.frequency === 'other' && !item.frequencyText) {
      problems.push({ field: at('frequencyText'), message: 'Describe the frequency' });
    }
    if (!item.durationDays) {
      problems.push({ field: at('durationDays'), message: 'Duration is required' });
    }
  });
  return problems;
}

/** The patient's recorded allergy substances. */
export async function patientAllergies(patientId: Types.ObjectId | string) {
  const p = await Patient.findById(patientId).select('allergies.substance').lean();
  return (p?.allergies ?? []).map((a) => ({ substance: a.substance }));
}

const sameSubstance = (a: string, b: string) =>
  drugComponents(a).join('+') === drugComponents(b).join('+');

/**
 * Items whose drug matches one of the patient's CURRENT allergies without an acknowledgement
 * of that allergy (spec §8.6) – for 422 ALLERGY_ACK_REQUIRED `details`. An allergy recorded after
 * the doctor acknowledged another one is not covered by that acknowledgement.
 */
export function unacknowledgedAllergies(
  items: readonly PrescriptionItem[],
  allergies: readonly { substance: string }[],
  prefix = '',
) {
  const matches = checkAllergies(items, allergies);
  return items.flatMap((item, i) => {
    const match = matches[i];
    if (!match) return [];
    const ack = item.allergyWarning;
    if (ack?.acknowledgedAt && sameSubstance(ack.substance, match.substance)) return [];
    return [
      {
        field: `${prefix}items.${i}`,
        itemIndex: i,
        drugName: item.drugName,
        substance: match.substance,
        drugClass: match.drugClass,
        message: 'Acknowledge the allergy warning to prescribe this drug',
      },
    ];
  });
}

export const allergyAckRequired = (details: unknown[]) =>
  new ApiError(
    422,
    'Some drugs match a recorded allergy. Review and acknowledge each warning before issuing.',
    ERROR_CODES.ALLERGY_ACK_REQUIRED,
    details,
  );

// ---- Draft items -----------------------------------------------------------------------------

/** Removes null/undefined so optional fields are simply absent in the stored item. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}

/**
 * Stored items for a draft: each is checked against the patient's allergies. A match keeps an
 * earlier acknowledgement of the same drug and allergy (so autosave does not undo it), takes a
 * new one when `acknowledgeAllergy: true`, and drops it when `acknowledgeAllergy: false`.
 * Changing the drug resets the acknowledgement.
 */
export function buildItems(
  input: readonly PrescriptionItemInput[],
  previous: readonly PrescriptionItem[],
  allergies: readonly { substance: string }[],
  by: string,
  now = new Date(),
) {
  const matches = checkAllergies(input, allergies);
  return input.map((raw, i) => {
    const { acknowledgeAllergy, ...fields } = raw;
    const match = matches[i];
    let allergyWarning: Record<string, unknown> | undefined;
    if (match) {
      const key = drugKey(fields);
      const earlier = previous.find(
        (p) =>
          p.allergyWarning?.acknowledgedAt &&
          drugKey(p) === key &&
          sameSubstance(p.allergyWarning.substance, match.substance),
      )?.allergyWarning;
      const ack =
        acknowledgeAllergy === true
          ? { acknowledgedBy: new Types.ObjectId(by), acknowledgedAt: now }
          : acknowledgeAllergy === false || !earlier
            ? {}
            : { acknowledgedBy: earlier.acknowledgedBy, acknowledgedAt: earlier.acknowledgedAt };
      allergyWarning = compact({
        substance: match.substance.trim(),
        matchedOn: match.matchedOn,
        drugClass: match.drugClass,
        ...ack,
      });
    }
    return { ...compact(fields), ...(allergyWarning ? { allergyWarning } : {}) };
  });
}

/** Counts for the audit log (never drug names or allergy substances). */
const allergyCounts = (p: Pick<PrescriptionLike, 'items'>) => {
  const warnings = allergyWarningsOf(p);
  return {
    itemCount: (p.items ?? []).length,
    allergyWarnings: warnings.length,
    allergyWarningsAcknowledged: warnings.filter((w) => w.acknowledged).length,
  };
};

// ---- PUT /encounters/:id/prescription --------------------------------------------------------

/**
 * Creates or replaces the draft prescription of the doctor's own note (spec §7.12): while the
 * note is a draft (within the documentation window), or – for a reissued draft – after signing.
 * An existing draft needs `expectedVersion` (its revision) → 409 CONFLICT when stale. The
 * response carries the allergy warnings; audited `prescription.update` (debounced, counts only).
 */
export async function putDraft(
  user: AuthUser,
  encounterId: string,
  input: PutPrescriptionInput,
  meta: RequestMeta,
) {
  const e = await loadEncounter(encounterId);
  await assertCanWriteEncounter(user, e, meta);
  const current = await Prescription.findOne({ encounter: e._id, isCurrent: true }).lean();
  if (current && current.status !== 'draft') throw lockedPrescription();
  const isReissueDraft = Boolean(current?.replaces);
  if (!isReissueDraft) {
    if (e.status !== 'draft') {
      throw new ApiError(
        409,
        'This note is signed. To change its prescription, reissue the prescription.',
        ERROR_CODES.RECORD_LOCKED,
      );
    }
    await assertDocumentationOpen(e.appointment);
  }
  if (current && input.expectedVersion !== (current.__v ?? 0)) {
    throw staleRevision(current.__v ?? 0);
  }

  const allergies = await patientAllergies(e.patient._id);
  const items = buildItems(input.items, current?.items ?? [], allergies, user.id);
  const general =
    input.generalInstructions === undefined ? undefined : (input.generalInstructions ?? null);

  let saved: { _id: Types.ObjectId } | null;
  if (current) {
    saved = await Prescription.findOneAndUpdate(
      { _id: current._id, __v: current.__v ?? 0, status: 'draft' },
      {
        $set: {
          items,
          updatedBy: user.id,
          ...(general ? { generalInstructions: general } : {}),
        },
        ...(general === null ? { $unset: { generalInstructions: '' } } : {}),
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!saved) {
      const fresh = await Prescription.findById(current._id).select('status __v').lean();
      if (fresh && fresh.status !== 'draft') throw lockedPrescription();
      throw staleRevision(fresh?.__v ?? 0);
    }
  } else {
    try {
      saved = await Prescription.create({
        encounter: e._id,
        appointment: e.appointment,
        patient: e.patient._id,
        doctor: e.doctor._id,
        items,
        ...(general ? { generalInstructions: general } : {}),
        createdBy: user.id,
        updatedBy: user.id,
      });
    } catch (err) {
      // Another tab created the draft at the same moment.
      if (isDuplicateKey(err)) throw staleRevision(0);
      throw err;
    }
  }

  const view = await loadPrescription(saved._id);
  await audit.recordDebounced({
    action: AUDIT_ACTIONS.PRESCRIPTION_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(view),
    patient: patientIdOf(view),
    request: meta,
    changes: { fields: ['items', ...(general !== undefined ? ['generalInstructions'] : [])] },
    metadata: allergyCounts(view),
  });
  return toDoctorView(view);
}

// ---- Issue -----------------------------------------------------------------------------------

/**
 * Issues a draft inside the caller's transaction: RX number from the counter, status issued.
 * Conditional on the draft's revision, so a draft changed after the checks is not issued.
 */
export async function issueDraftInSession(
  rx: { _id: Types.ObjectId; status: string; __v?: number },
  { by, session, now = new Date() }: { by: string; session: ClientSession; now?: Date },
) {
  assertTransition('prescription', rx.status, 'issued');
  const { timezone } = await getSettings();
  const year = Number(clinicToday(timezone, now).slice(0, 4));
  const seq = await nextSequence(`${SEQUENCES.PRESCRIPTION.key}:${year}`, { session });
  const issued = await Prescription.findOneAndUpdate(
    { _id: rx._id, status: 'draft', __v: rx.__v ?? 0 },
    {
      $set: {
        status: 'issued',
        prescriptionNumber: formatNumber(SEQUENCES.PRESCRIPTION.prefix, seq, { year }),
        issuedAt: now,
        issuedBy: by,
        updatedBy: by,
      },
      $inc: { __v: 1 },
    },
    { new: true, session },
  ).lean();
  if (!issued) throw staleRevision((rx.__v ?? 0) + 1);
  return issued as PrescriptionDoc & { _id: Types.ObjectId };
}

/** Audit + patient notification after a prescription was issued (after the commit). */
export async function afterIssued(
  user: AuthUser,
  prescriptionId: Types.ObjectId,
  meta: RequestMeta,
  via: 'sign' | 'issue',
) {
  const p = await loadPrescription(prescriptionId);
  await audit.record({
    action: AUDIT_ACTIONS.PRESCRIPTION_ISSUE,
    actor: actorOf(user),
    resource: resourceOf(p),
    patient: patientIdOf(p),
    request: meta,
    metadata: { via, ...allergyCounts(p), ...(p.replaces ? { replaces: p.replaces } : {}) },
  });
  // In-app only (spec §11); stored from Phase 10. No clinical details (§10.3).
  const patientUser = (await Patient.findById(patientIdOf(p)).select('user').lean())?.user;
  if (patientUser) {
    void notify({
      recipients: [{ userId: patientUser.toString() }],
      type: NOTIFICATION_TYPES.PRESCRIPTION_ISSUED,
      title: 'New prescription',
      body: 'Your doctor has issued a prescription. Log in to view it.',
      link: `/patient/prescriptions/${p._id.toString()}`,
      email: false,
    });
  }
  return p;
}

/**
 * POST /prescriptions/:id/issue – issues a reissued draft (the note is already signed; first
 * prescriptions are issued by signing). Same checks as signing: complete items → else 422
 * SIGN_VALIDATION_FAILED, every allergy match acknowledged → else 422 ALLERGY_ACK_REQUIRED.
 */
export async function issuePrescription(
  user: AuthUser,
  id: string,
  input: { expectedVersion?: number } | undefined,
  meta: RequestMeta,
) {
  const rx = await loadPrescription(id);
  await assertCanWritePrescription(user, rx, meta);
  assertTransition('prescription', rx.status, 'issued');
  const e = await loadEncounter(rx.encounter);
  if (e.status === 'draft') {
    throw ApiError.unprocessable('This prescription is issued when you sign the note.');
  }
  if (input?.expectedVersion !== undefined && input.expectedVersion !== (rx.__v ?? 0)) {
    throw staleRevision(rx.__v ?? 0);
  }
  const problems: FieldProblem[] =
    rx.items.length === 0 ? [{ field: 'items', message: 'Add at least one drug' }] : [];
  problems.push(...issueProblems(rx.items));
  if (problems.length > 0) {
    throw new ApiError(
      422,
      'The prescription is incomplete',
      ERROR_CODES.SIGN_VALIDATION_FAILED,
      problems,
    );
  }
  const unacknowledged = unacknowledgedAllergies(rx.items, await patientAllergies(patientIdOf(rx)));
  if (unacknowledged.length > 0) throw allergyAckRequired(unacknowledged);

  const issued = await withTransaction((session) =>
    issueDraftInSession(rx, { by: user.id, session }),
  );
  return toDoctorView(await afterIssued(user, issued._id, meta, 'issue'));
}

// ---- Cancel and reissue ----------------------------------------------------------------------

const cancellation = (by: string, reason: string, at = new Date()) => ({
  status: 'cancelled',
  isCurrent: false,
  cancellation: { by: new Types.ObjectId(by), at, reason },
  updatedBy: by,
});

/** POST /prescriptions/:id/cancel – issued → cancelled with a reason (spec §5.3). */
export async function cancelPrescription(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const rx = await loadPrescription(id);
  await assertCanWritePrescription(user, rx, meta);
  assertTransition('prescription', rx.status, 'cancelled');
  const updated = await Prescription.findOneAndUpdate(
    { _id: rx._id, status: 'issued' },
    { $set: cancellation(user.id, reason), $inc: { __v: 1 } },
    { new: true },
  ).lean();
  if (!updated) {
    const fresh = await Prescription.findById(rx._id).select('status').lean();
    throw invalidTransition('prescription', fresh?.status ?? rx.status, 'cancelled');
  }
  await audit.record({
    action: AUDIT_ACTIONS.PRESCRIPTION_CANCEL,
    actor: actorOf(user),
    resource: resourceOf(rx),
    patient: patientIdOf(rx),
    request: meta,
    metadata: { reasonGiven: true },
  });
  return toDoctorView(await loadPrescription(rx._id));
}

/**
 * POST /prescriptions/:id/reissue – in one transaction: cancel the current issued prescription
 * and create a new DRAFT copying its items (`replaces` set, isCurrent). Allergy warnings are
 * re-checked and must be acknowledged again before the new draft is issued
 * (POST /prescriptions/:id/issue). Parallel reissues: one wins, the others get 409.
 */
export async function reissuePrescription(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
) {
  const rx = await loadPrescription(id);
  await assertCanWritePrescription(user, rx, meta);
  assertTransition('prescription', rx.status, 'cancelled');
  if (!rx.isCurrent) throw invalidTransition('prescription', rx.status, 'cancelled');
  const allergies = await patientAllergies(patientIdOf(rx));
  const copied = buildItems(
    rx.items.map((i) => {
      const { allergyWarning: _ignored, ...rest } = i;
      return rest as PrescriptionItemInput;
    }),
    [],
    allergies,
    user.id,
  );

  let draftId: Types.ObjectId;
  try {
    draftId = await withTransaction(async (session) => {
      const cancelled = await Prescription.findOneAndUpdate(
        { _id: rx._id, status: 'issued', isCurrent: true },
        { $set: cancellation(user.id, reason), $inc: { __v: 1 } },
        { new: true, session },
      ).lean();
      if (!cancelled) {
        const fresh = await Prescription.findById(rx._id).select('status').session(session).lean();
        throw invalidTransition('prescription', fresh?.status ?? rx.status, 'cancelled');
      }
      const [draft] = await Prescription.create(
        [
          {
            encounter: rx.encounter,
            appointment: rx.appointment,
            patient: patientIdOf(rx),
            doctor: rx.doctor._id,
            items: copied,
            ...(rx.generalInstructions ? { generalInstructions: rx.generalInstructions } : {}),
            replaces: rx._id,
            createdBy: user.id,
            updatedBy: user.id,
          },
        ],
        { session },
      );
      return draft!._id;
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw invalidTransition('prescription', 'cancelled', 'cancelled');
    throw err;
  }

  await audit.record({
    action: AUDIT_ACTIONS.PRESCRIPTION_CANCEL,
    actor: actorOf(user),
    resource: resourceOf(rx),
    patient: patientIdOf(rx),
    request: meta,
    metadata: { reasonGiven: true, reissuedAs: draftId },
  });
  const draft = await loadPrescription(draftId);
  await audit.record({
    action: AUDIT_ACTIONS.PRESCRIPTION_REISSUE,
    actor: actorOf(user),
    resource: resourceOf(draft),
    patient: patientIdOf(draft),
    request: meta,
    metadata: { replaces: rx._id, replacesNumber: rx.prescriptionNumber, ...allergyCounts(draft) },
  });
  return toDoctorView(draft);
}

// ---- Reads -----------------------------------------------------------------------------------

/** GET /prescriptions/:id – scoped per role; audited `prescription.view` (debounced). */
export async function getPrescription(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user); // 403 while the link is pending
  const p = await loadPrescription(id);
  await assertCanReadPrescription(user, p, meta);
  await audit.recordRead({
    action: AUDIT_ACTIONS.PRESCRIPTION_VIEW,
    actor: actorOf(user),
    resource: resourceOf(p),
    patient: patientIdOf(p),
    request: meta,
  });
  return viewForRole(user, p);
}

/** The base filter per role for GET /prescriptions (after the patient checks). */
async function roleFilter(
  user: AuthUser,
  query: ListPrescriptionsQuery,
  meta: RequestMeta,
): Promise<FilterQuery<PrescriptionDoc>> {
  switch (user.role) {
    case ROLES.DOCTOR: {
      const me = new Types.ObjectId(user.id);
      const others = { status: { $ne: 'draft' } };
      if (query.patient) {
        await assertCanAccessPatient(user, query.patient, 'clinical', meta);
        return { $or: [{ doctor: me }, others] };
      }
      return {
        $or: [{ doctor: me }, { ...others, patient: { $in: await relatedPatientIds(user.id) } }],
      };
    }
    case ROLES.PATIENT: {
      const own = await resolveMyPatientId(user);
      return { patient: new Types.ObjectId(own), status: { $in: ISSUED_STATUSES } };
    }
    case ROLES.RECEPTIONIST: {
      if (!query.patient && !query.appointment && !query.encounter) {
        throw ApiError.validation('Choose a patient or an appointment', [
          { field: 'query.patient', message: 'Choose a patient or an appointment' },
        ]);
      }
      if (query.patient) await assertCanAccessPatient(user, query.patient, 'demographics', meta);
      return { status: { $in: ISSUED_STATUSES } };
    }
    default:
      return { _id: { $in: [] } };
  }
}

/**
 * GET /prescriptions – doctors: their own and issued prescriptions of related patients;
 * patients: their own issued/completed; receptionists: issued/completed of one patient or
 * appointment (printing). Newest first; list items carry no drug names (not audited per row).
 */
export async function listPrescriptions(
  user: AuthUser,
  query: ListPrescriptionsQuery,
  { page, limit, skip }: Pagination,
  meta: RequestMeta,
) {
  const and: FilterQuery<PrescriptionDoc>[] = [await roleFilter(user, query, meta)];
  if (query.patient) and.push({ patient: new Types.ObjectId(query.patient) });
  if (query.appointment) and.push({ appointment: new Types.ObjectId(query.appointment) });
  if (query.encounter) and.push({ encounter: new Types.ObjectId(query.encounter) });
  if (query.status) and.push({ status: query.status });
  if (query.from || query.to) {
    const { timezone } = await getSettings();
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfClinicDay(query.from, timezone);
    if (query.to) range.$lte = endOfClinicDay(query.to, timezone);
    and.push({ issuedAt: range });
  }
  const filter = { $and: and };
  const [items, total] = await Promise.all([
    Prescription.find(filter)
      .sort({ issuedAt: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate([...PRESCRIPTION_POPULATE])
      .lean(),
    Prescription.countDocuments(filter),
  ]);
  const withPatient = user.role !== ROLES.PATIENT;
  return {
    items: (items as unknown as PrescriptionLike[]).map((p) => toListItem(p, { withPatient })),
    meta: buildMeta({ page, limit, total }),
  };
}
