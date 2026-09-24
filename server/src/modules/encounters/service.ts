import type { FilterQuery, Types } from 'mongoose';
import { AUDIT_ACTIONS, ENCOUNTER_RULES, ERROR_CODES } from '../../config/constants.js';
import { assertCanViewAppointment } from '../../policies/appointmentAccess.js';
import {
  assertCanReadEncounter,
  assertCanWriteEncounter,
  encounterListFilter,
} from '../../policies/encounterAccess.js';
import { assertCanAccessPatient } from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { Appointment } from '../appointments/model.js';
import { loadAppointment } from '../appointments/service.js';
import { getSettings } from '../settings/service.js';
import { Encounter, type EncounterDoc } from './model.js';
import { ENCOUNTER_POPULATE, toDoctorView, toListItem, type EncounterLike } from './serializer.js';
import type { ListEncountersQuery, UpdateEncounterInput } from './validation.js';
import { computeBmi } from './vitals.js';

export const resourceOf = (e: { _id: Types.ObjectId; encounterNumber: string }) => ({
  type: 'encounter',
  id: e._id,
  number: e.encounterNumber,
});

const patientIdOf = (e: EncounterLike) => e.patient._id;

/** An encounter with doctor and patient populated. 404 if missing. */
export async function loadEncounter(id: string | Types.ObjectId): Promise<EncounterLike> {
  const e = await Encounter.findById(id)
    .populate([...ENCOUNTER_POPULATE])
    .lean();
  if (!e) throw ApiError.notFound('Clinical note not found');
  return e as unknown as EncounterLike;
}

// ---- Documentation window (spec §8.5) --------------------------------------------------------

const WINDOW_MS = ENCOUNTER_RULES.documentationWindowHours * 60 * 60_000;

interface AppointmentTimes {
  status: string;
  queue?: { completedAt?: Date | null } | null;
  statusHistory?: { status: string; at: Date }[] | null;
}

/** When the appointment was completed (queue time, else the status history). */
function completedAtOf(appt: AppointmentTimes): Date | null {
  if (appt.queue?.completedAt) return appt.queue.completedAt;
  const entry = [...(appt.statusHistory ?? [])].reverse().find((h) => h.status === 'completed');
  return entry?.at ?? null;
}

/**
 * A note can be edited or signed while its appointment is in consultation, or up to 72 hours
 * after it was completed (late documentation); after that only amendments (spec §8.5).
 */
export function isDocumentationOpen(appt: AppointmentTimes, now = new Date()): boolean {
  if (appt.status === 'in_consultation') return true;
  if (appt.status !== 'completed') return false;
  const completedAt = completedAtOf(appt);
  return completedAt !== null && now.getTime() - completedAt.getTime() <= WINDOW_MS;
}

/** 422 DOCUMENTATION_WINDOW_CLOSED unless the note's appointment is within the window. */
export async function assertDocumentationOpen(appointmentId: Types.ObjectId, now = new Date()) {
  const appt = await Appointment.findById(appointmentId)
    .select('status queue.completedAt statusHistory')
    .lean();
  if (!appt || !isDocumentationOpen(appt, now)) {
    throw new ApiError(
      422,
      `This note can no longer be edited: notes are editable during the consultation and up to ` +
        `${ENCOUNTER_RULES.documentationWindowHours} hours after it. Sign it as it is, or amend ` +
        'it after signing.',
      ERROR_CODES.DOCUMENTATION_WINDOW_CLOSED,
    );
  }
}

// ---- Reads -----------------------------------------------------------------------------------

async function auditView(user: AuthUser, e: EncounterLike, meta: RequestMeta) {
  await audit.recordRead({
    action: AUDIT_ACTIONS.ENCOUNTER_VIEW,
    actor: actorOf(user),
    resource: resourceOf(e),
    patient: patientIdOf(e),
    request: meta,
  });
}

/**
 * GET /encounters/:id – the note's doctor, or (signed notes only) a doctor with a care
 * relationship; others 404. Audited `encounter.view`, debounced 5 min per user + note.
 */
export async function getEncounter(user: AuthUser, id: string, meta: RequestMeta) {
  const e = await loadEncounter(id);
  await assertCanReadEncounter(user, e, meta);
  await auditView(user, e, meta);
  return toDoctorView(e);
}

/**
 * GET /appointments/:id/encounter – the note of the doctor's own appointment (consult
 * workspace). 404 for other doctors' appointments and while no note exists.
 */
export async function getEncounterForAppointment(
  user: AuthUser,
  appointmentId: string,
  meta: RequestMeta,
) {
  const appt = await loadAppointment(appointmentId);
  await assertCanViewAppointment(user, appt, meta);
  const found = await Encounter.findOne({ appointment: appt._id }).select('_id').lean();
  if (!found) throw ApiError.notFound('This appointment has no clinical note yet');
  const e = await loadEncounter(found._id);
  await assertCanReadEncounter(user, e, meta);
  await auditView(user, e, meta);
  return toDoctorView(e);
}

/**
 * GET /encounters (doctor) – own notes and signed notes of related patients, newest visit
 * first. With `patient`, that patient's history (404 without a care relationship), with each
 * visit's primary diagnosis (audited as a debounced read of the history). Otherwise list items
 * carry no clinical text and the list is not audited.
 */
export async function listEncounters(
  user: AuthUser,
  query: ListEncountersQuery,
  { page, limit, skip }: Pagination,
  meta: RequestMeta,
) {
  if (query.patient) await assertCanAccessPatient(user, query.patient, 'clinical', meta);
  const and: FilterQuery<EncounterDoc>[] = [await encounterListFilter(user, query.patient)];
  if (query.status) and.push({ status: query.status });
  if (query.from || query.to) {
    const { timezone } = await getSettings();
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfClinicDay(query.from, timezone);
    if (query.to) range.$lte = endOfClinicDay(query.to, timezone);
    and.push({ visitAt: range });
  }
  const filter = { $and: and };
  const [items, total] = await Promise.all([
    Encounter.find(filter)
      .sort({ visitAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate([...ENCOUNTER_POPULATE])
      .lean(),
    Encounter.countDocuments(filter),
  ]);
  // One patient's history shows each visit's primary diagnosis: a clinical read, audited once
  // per user + patient (debounced).
  const withDiagnosis = Boolean(query.patient);
  if (withDiagnosis && items.length > 0) {
    await audit.recordRead({
      action: AUDIT_ACTIONS.ENCOUNTER_VIEW,
      actor: actorOf(user),
      resource: { type: 'encounter_history', id: query.patient },
      patient: query.patient,
      request: meta,
    });
  }
  return {
    items: (items as unknown as EncounterLike[]).map((e) => toListItem(e, { withDiagnosis })),
    meta: buildMeta({ page, limit, total }),
  };
}

// ---- Autosave (PATCH) ------------------------------------------------------------------------

const TEXT_FIELDS = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'pastHistory',
  'examination',
  'assessment',
  'plan',
  'adviceToPatient',
] as const;

type Changes = Omit<UpdateEncounterInput, 'expectedVersion'>;

/**
 * The `$set` / `$unset` for note changes: null or empty text clears a field; vitals merge into
 * the stored ones (null clears one) and recompute BMI whenever weight or height change, stamping
 * recordedAt/By. Used by autosave and (Phase 5 step 2) amendments.
 */
export function buildNoteUpdate(
  current: Pick<EncounterDoc, 'vitals'>,
  changes: Changes,
  by: string,
  now = new Date(),
) {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};

  for (const field of TEXT_FIELDS) {
    const value = changes[field];
    if (value === undefined) continue;
    if (value === null) $unset[field] = '';
    else $set[field] = value;
  }
  if (changes.diagnoses !== undefined) {
    $set.diagnoses = changes.diagnoses.map((d) => ({ ...d, icd10Code: d.icd10Code ?? undefined }));
  }
  if (changes.followUp !== undefined) {
    const f = changes.followUp;
    $set.followUp = {
      required: f.required,
      ...(f.afterDays !== null ? { afterDays: f.afterDays } : {}),
      ...(f.date !== null ? { date: f.date } : {}),
      ...(f.instructions !== null ? { instructions: f.instructions } : {}),
    };
  }
  if (changes.vitals !== undefined && Object.keys(changes.vitals).length > 0) {
    const merged = { ...(current.vitals ?? {}) } as Record<string, number | null | undefined>;
    for (const [key, value] of Object.entries(changes.vitals)) {
      merged[key] = value;
      if (value === null) $unset[`vitals.${key}`] = '';
      else $set[`vitals.${key}`] = value;
    }
    if ('weightKg' in changes.vitals || 'heightCm' in changes.vitals) {
      const bmi = computeBmi(merged.weightKg, merged.heightCm);
      if (bmi === null) $unset['vitals.bmi'] = '';
      else $set['vitals.bmi'] = bmi;
    }
    $set['vitals.recordedAt'] = now;
    $set['vitals.recordedBy'] = by;
  }
  return { $set, $unset };
}

/** Top-level names of the fields a change touches (for the audit log – never values). */
export const changedFieldNames = (changes: Changes) =>
  Object.keys(changes)
    .filter((k) => changes[k as keyof Changes] !== undefined)
    .sort();

const staleRevision = (current: number) =>
  ApiError.conflict(
    'This note was changed in another tab or window. Reload it to see the latest version.',
    { currentRevision: current },
  );

const lockedNote = () =>
  new ApiError(
    409,
    'This note is signed and can only be changed by an amendment',
    ERROR_CODES.RECORD_LOCKED,
  );

/**
 * PATCH /encounters/:id – autosave of the doctor's own draft (spec §4.7 step 4) within the
 * documentation window. `expectedVersion` must equal the stored revision (`__v`), else 409
 * CONFLICT ("changed in another tab"); each save increments it. Audited `encounter.update` with
 * the changed field names only, debounced to one entry per user + note per 5 minutes.
 */
export async function updateEncounter(
  user: AuthUser,
  id: string,
  input: UpdateEncounterInput,
  meta: RequestMeta,
) {
  const { expectedVersion, ...changes } = input;
  const e = await loadEncounter(id);
  await assertCanWriteEncounter(user, e, meta);
  if (e.status !== 'draft') throw lockedNote();
  await assertDocumentationOpen(e.appointment);
  if ((e.__v ?? 0) !== expectedVersion) throw staleRevision(e.__v ?? 0);

  const { $set, $unset } = buildNoteUpdate(e, changes, user.id);
  const updated = await Encounter.findOneAndUpdate(
    { _id: e._id, __v: expectedVersion, status: 'draft' },
    {
      $set: { ...$set, updatedBy: user.id },
      ...(Object.keys($unset).length > 0 ? { $unset } : {}),
      $inc: { __v: 1 },
    },
    { new: true, runValidators: true },
  )
    .populate([...ENCOUNTER_POPULATE])
    .lean();
  if (!updated) {
    const fresh = await Encounter.findById(e._id).select('status __v').lean();
    if (fresh && fresh.status !== 'draft') throw lockedNote();
    throw staleRevision(fresh?.__v ?? 0);
  }

  await audit.recordDebounced({
    action: AUDIT_ACTIONS.ENCOUNTER_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(e),
    patient: patientIdOf(e),
    request: meta,
    changes: { fields: changedFieldNames(changes) },
  });
  return toDoctorView(updated as unknown as EncounterLike);
}
