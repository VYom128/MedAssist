import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  ROLES,
  SEQUENCES,
  type DuplicateMatchReason,
} from '../../config/constants.js';
import {
  assertCanAccessPatient,
  canAccessPatient,
  patientListFilter,
  roleHasPatientScope,
} from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  calendarDate,
  clinicToday,
  endOfClinicDay,
  startOfClinicDay,
  subtractYears,
} from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { buildPatientSearchQuery } from '../../utils/search.js';
import { withTransaction } from '../../utils/transaction.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { nameKeyOf, Patient, type PatientDoc } from './model.js';
import {
  toAdminView,
  toDoctorView,
  toDuplicateMatch,
  toListItem,
  viewForRole,
  type PatientLike,
  type PortalInfo,
} from './serializer.js';
import type {
  AllergyInput,
  CheckDuplicateQuery,
  ChronicConditionInput,
  ClinicalProfileInput,
  CreatePatientInput,
  ListPatientsQuery,
  UpdatePatientInput,
} from './validation.js';

const resourceOf = (p: Pick<PatientLike, '_id' | 'mrn'>) => ({
  type: 'patient',
  id: p._id,
  number: p.mrn,
});

export async function loadPatient(id: string | Types.ObjectId): Promise<PatientLike> {
  const p = (await Patient.findById(id).lean()) as PatientLike | null;
  if (!p) throw ApiError.notFound('Patient not found');
  return p;
}

/** The portal account of a patient (linked or waiting for verification), for staff views. */
export async function portalInfo(patientId: string | Types.ObjectId): Promise<PortalInfo> {
  const user = await User.findOne({ patient: patientId, role: ROLES.PATIENT })
    .select('email patientLinkStatus lastLoginAt')
    .lean();
  return {
    hasAccount: Boolean(user),
    email: user?.email ?? null,
    linkStatus: user?.patientLinkStatus ?? null,
    lastLoginAt: user?.lastLoginAt ?? null,
  };
}

/** The role's view, with the portal account for staff who manage it. */
export async function viewFor(user: AuthUser, p: PatientLike) {
  const staff = user.role === ROLES.ADMIN || user.role === ROLES.RECEPTIONIST;
  return viewForRole(user.role, p, staff ? await portalInfo(p._id) : undefined);
}

// ---- Audit ---------------------------------------------------------------------------------

/** Fields whose before/after values are safe to keep in the audit log (not identifying). */
const AUDIT_VALUE_FIELDS = new Set([
  'gender',
  'bloodGroup',
  'preferredLanguage',
  'isActive',
  'consentAiExplanations',
  'consentCommunications',
]);

/**
 * `diffChanges` for patient records: changed field names always; before/after values only for
 * non-identifying fields. Names, DOB, contact details, allergies etc. are '[REDACTED]' (§10.4).
 */
export function patientChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
) {
  const changes = audit.diffChanges(before, after, fields);
  const mask = (values: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, AUDIT_VALUE_FIELDS.has(k) ? v : audit.REDACTED]),
    );
  return { fields: changes.fields, before: mask(changes.before), after: mask(changes.after) };
}

// ---- Duplicates (spec §4.3) ----------------------------------------------------------------

interface DuplicateCriteria {
  dateOfBirth: Date;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Patients with the same phone + DOB, or the same name + DOB (names compared lower-case with
 * single spaces). Inactive patients are included: re-registering one is still a duplicate.
 */
export async function findDuplicates(criteria: DuplicateCriteria, exceptId?: string) {
  const { dateOfBirth, phone } = criteria;
  const nameKey =
    criteria.firstName && criteria.lastName
      ? nameKeyOf(criteria.firstName, criteria.lastName)
      : undefined;
  const or: FilterQuery<PatientDoc>[] = [];
  if (phone) or.push({ phone, dateOfBirth });
  if (nameKey) or.push({ nameKey, dateOfBirth });
  if (or.length === 0) return [];

  const found = (await Patient.find({
    $or: or,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .sort({ createdAt: 1 })
    .limit(20)
    .lean()) as PatientLike[];

  const sameDob = (p: PatientLike) => p.dateOfBirth.getTime() === dateOfBirth.getTime();
  return found.map((p) => {
    const matchedOn: DuplicateMatchReason[] = [];
    if (phone && p.phone === phone && sameDob(p)) matchedOn.push('phone_dob');
    if (nameKey && p.nameKey === nameKey && sameDob(p)) matchedOn.push('name_dob');
    return toDuplicateMatch(p, matchedOn);
  });
}

type DuplicateMatch = Awaited<ReturnType<typeof findDuplicates>>[number];

const duplicatePatient = (matches: DuplicateMatch[]) =>
  new ApiError(
    409,
    'This may be a patient who is already registered. Open the existing record, or confirm with a reason to continue.',
    ERROR_CODES.DUPLICATE_PATIENT,
    { matches },
  );

/** GET /patients/check-duplicate */
export async function checkDuplicate(query: CheckDuplicateQuery) {
  return { matches: await findDuplicates(query) };
}

// ---- Allergies and conditions --------------------------------------------------------------

type Recorded = Record<string, unknown> & {
  _id: Types.ObjectId;
  recordedBy?: Types.ObjectId | null;
  recordedAt?: Date | null;
};

/** Drops null/undefined values, so stored entries and input compare equal. */
const compact = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as T;

/**
 * Replaces a list of recorded entries (allergies, conditions). An input entry with the `id` of
 * an unchanged existing entry keeps it as it is (who recorded it and when); anything new or
 * changed is recorded by `user` now.
 */
export function mergeRecorded(
  input: ({ id?: string } & Record<string, unknown>)[],
  existing: readonly unknown[],
  keys: readonly string[],
  user: Pick<AuthUser, 'id'>,
  now = new Date(),
): Recorded[] {
  const byId = new Map((existing as Recorded[]).map((e) => [e._id.toString(), e]));
  return input.map(({ id, ...rest }) => {
    const values = compact(rest);
    const old = id ? byId.get(id) : undefined;
    const same =
      old &&
      keys.every(
        (k) => audit.diffChanges({ v: old[k] }, { v: values[k] }, ['v']).fields.length === 0,
      );
    if (old && same) return old;
    return {
      ...values,
      _id: old?._id ?? new Types.ObjectId(),
      recordedBy: new Types.ObjectId(user.id),
      recordedAt: now,
    };
  });
}

const mergeAllergies = (input: AllergyInput[], existing: readonly unknown[], user: AuthUser) =>
  mergeRecorded(input, existing, ['substance', 'reaction', 'severity'], user);

const mergeConditions = (
  input: ChronicConditionInput[],
  existing: readonly unknown[],
  user: AuthUser,
) => mergeRecorded(input, existing, ['name', 'since', 'notes'], user);

const cannotRecordAllergies = () =>
  ApiError.forbidden("Only reception or the patient's doctor can record allergies", [
    { field: 'body.allergies', message: 'Your role cannot record allergies' },
  ]);

// ---- Create --------------------------------------------------------------------------------

/**
 * Inserts a patient with the next MRN, in `session` (the caller's transaction) or a new one.
 * The MRN is only used if the transaction commits (spec §8.10: never reused).
 */
export async function insertPatient(
  fields: Omit<PatientDoc, 'mrn' | 'nameKey' | 'isActive' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<PatientDoc, 'isActive'>>,
  { session }: { session?: ClientSession } = {},
): Promise<PatientLike> {
  const run = async (s: ClientSession) => {
    const seq = await nextSequence(SEQUENCES.MRN.key, { session: s });
    const [doc] = await Patient.create(
      [
        {
          ...fields,
          mrn: formatNumber(SEQUENCES.MRN.prefix, seq),
          nameKey: nameKeyOf(fields.firstName, fields.lastName),
        },
      ],
      { session: s },
    );
    return doc!.toObject() as PatientLike;
  };
  return session ? run(session) : withTransaction(run);
}

/**
 * POST /patients (spec §4.3). Runs the duplicate check; possible duplicates → 409
 * DUPLICATE_PATIENT with `details.matches`, unless `force` with a reason (audited as
 * `patient.create_duplicate_override`). Only receptionists may include allergies.
 */
export async function createPatient(user: AuthUser, input: CreatePatientInput, meta: RequestMeta) {
  const { force, reason, consent, allergies, ...fields } = input;
  if (allergies?.length && !roleHasPatientScope(user, 'allergies')) throw cannotRecordAllergies();

  const matches = await findDuplicates(fields);
  if (matches.length > 0 && !force) throw duplicatePatient(matches);

  const now = new Date();
  const created = await insertPatient({
    ...fields,
    allergies: mergeAllergies(allergies ?? [], [], user),
    chronicConditions: [],
    consent: {
      dataProcessing: { given: consent.dataProcessing, at: now },
      aiExplanations: { given: consent.aiExplanations ?? true, at: now },
      communications: { email: true, sms: false, ...compact(consent.communications ?? {}) },
    },
    registeredBy: new Types.ObjectId(user.id),
    updatedBy: new Types.ObjectId(user.id),
  } as never);

  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: created._id,
    request: meta,
    metadata: { possibleDuplicates: matches.length },
  });
  if (matches.length > 0) await auditOverride(user, created, matches, reason!, meta, 'create');
  await getSettings(); // clinic timezone for ages
  return viewFor(user, created);
}

function auditOverride(
  user: AuthUser,
  p: PatientLike,
  matches: DuplicateMatch[],
  reason: string,
  meta: RequestMeta,
  kind: 'create' | 'update',
) {
  return audit.record({
    action:
      kind === 'create'
        ? AUDIT_ACTIONS.PATIENT_CREATE_DUPLICATE_OVERRIDE
        : AUDIT_ACTIONS.PATIENT_UPDATE_DUPLICATE_OVERRIDE,
    actor: actorOf(user),
    resource: resourceOf(p),
    patient: p._id,
    request: meta,
    metadata: {
      reason,
      matches: matches.map((m) => ({ id: m.id, mrn: m.mrn, matchedOn: m.matchedOn })),
    },
  });
}

// ---- Read ----------------------------------------------------------------------------------

/**
 * GET /patients/:id – the caller's view of the record (spec §2.5). Audited as `patient.view`,
 * debounced per user and patient (5 min). Patients may only open their own (others → 404).
 */
export async function getPatient(user: AuthUser, id: string, meta: RequestMeta) {
  await assertCanAccessPatient(user, id, 'demographics', meta);
  const p = await loadPatient(id);
  await getSettings();
  const view = await viewFor(user, p);
  await audit.recordRead({
    action: AUDIT_ACTIONS.PATIENT_VIEW,
    actor: actorOf(user),
    resource: resourceOf(p),
    patient: p._id,
    request: meta,
  });
  return view;
}

/**
 * GET /patients (spec §7.7, §12.1) – search (`q`: MRN, phone or name prefixes) and filters.
 * Only active patients, except for admins filtering on `isActive`. Not audited per row.
 */
export async function listPatients(
  user: AuthUser,
  query: ListPatientsQuery,
  { page, limit, skip }: Pagination,
) {
  const { timezone } = await getSettings();
  const and: FilterQuery<PatientDoc>[] = [patientListFilter(user)];

  and.push({
    isActive: user.role === ROLES.ADMIN && query.isActive !== undefined ? query.isActive : true,
  });
  if (query.q) {
    const search = buildPatientSearchQuery(query.q);
    if (search) and.push(search);
  }
  if (query.gender) and.push({ gender: query.gender });

  // Ages → date-of-birth range: age ≥ n ⇔ born on or before today − n years.
  const today = clinicToday(timezone);
  const dob: Record<string, Date> = {};
  if (query.ageMin !== undefined) dob.$lte = calendarDate(subtractYears(today, query.ageMin));
  if (query.ageMax !== undefined) dob.$gt = calendarDate(subtractYears(today, query.ageMax + 1));
  if (Object.keys(dob).length > 0) and.push({ dateOfBirth: dob });

  const registered: Record<string, Date> = {};
  if (query.registeredFrom) registered.$gte = startOfClinicDay(query.registeredFrom, timezone);
  if (query.registeredTo) registered.$lte = endOfClinicDay(query.registeredTo, timezone);
  if (Object.keys(registered).length > 0) and.push({ createdAt: registered });

  if (query.hasPortal !== undefined) {
    and.push(
      query.hasPortal ? { user: { $type: 'objectId' } } : { user: { $not: { $type: 'objectId' } } },
    );
  }

  const filter = { $and: and };
  const [items, total] = await Promise.all([
    Patient.find(filter).sort(query.sort).skip(skip).limit(limit).lean(),
    Patient.countDocuments(filter),
  ]);
  return {
    items: (items as PatientLike[]).map(toListItem),
    meta: buildMeta({ page, limit, total }),
  };
}

// ---- Update --------------------------------------------------------------------------------

/**
 * PATCH /patients/:id – demographics, contact, insurance, admin notes; allergies from
 * receptionists. Changing phone or DOB re-runs the duplicate check (409 unless force + reason).
 */
export async function updatePatient(
  user: AuthUser,
  id: string,
  input: UpdatePatientInput,
  meta: RequestMeta,
) {
  await assertCanAccessPatient(user, id, 'demographics', meta);
  const { force, reason, allergies, ...fields } = input;
  if (allergies !== undefined && !canAccessPatient(user, id, 'allergies')) {
    throw cannotRecordAllergies();
  }
  const before = await loadPatient(id);
  const next: Record<string, unknown> = { ...fields };
  if (allergies !== undefined) next.allergies = mergeAllergies(allergies, before.allergies, user);

  const changes = patientChanges(before, { ...before, ...next }, Object.keys(next));
  await getSettings();
  if (changes.fields.length === 0) return viewFor(user, before);

  let matches: DuplicateMatch[] = [];
  if (changes.fields.includes('phone') || changes.fields.includes('dateOfBirth')) {
    matches = await findDuplicates(
      {
        dateOfBirth: fields.dateOfBirth ?? before.dateOfBirth,
        phone: fields.phone ?? before.phone,
        firstName: fields.firstName ?? before.firstName,
        lastName: fields.lastName ?? before.lastName,
      },
      id,
    );
    if (matches.length > 0 && !force) throw duplicatePatient(matches);
  }

  const set: Record<string, unknown> = { ...next, updatedBy: user.id };
  if (fields.firstName !== undefined || fields.lastName !== undefined) {
    set.nameKey = nameKeyOf(
      fields.firstName ?? before.firstName,
      fields.lastName ?? before.lastName,
    );
  }
  await Patient.updateOne({ _id: id }, { $set: set }, { runValidators: true });
  const updated = await loadPatient(id);

  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(updated),
    patient: updated._id,
    request: meta,
    changes,
  });
  if (matches.length > 0) await auditOverride(user, updated, matches, reason!, meta, 'update');
  return viewFor(user, updated);
}

/**
 * PATCH /patients/:id/clinical-profile – allergies and chronic conditions, by a doctor with a
 * care relationship (Phase 5; until then every doctor gets 404). recordedBy/At set here.
 */
export async function updateClinicalProfile(
  user: AuthUser,
  id: string,
  input: ClinicalProfileInput,
  meta: RequestMeta,
) {
  await assertCanAccessPatient(user, id, 'clinical', meta);
  const before = await loadPatient(id);
  const next: Record<string, unknown> = {};
  if (input.allergies) next.allergies = mergeAllergies(input.allergies, before.allergies, user);
  if (input.chronicConditions) {
    next.chronicConditions = mergeConditions(
      input.chronicConditions,
      before.chronicConditions,
      user,
    );
  }
  const changes = patientChanges(before, { ...before, ...next }, Object.keys(next));
  await getSettings();
  if (changes.fields.length === 0) return toDoctorView(before);

  await Patient.updateOne(
    { _id: id },
    { $set: { ...next, updatedBy: user.id } },
    { runValidators: true },
  );
  const updated = await loadPatient(id);
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_CLINICAL_PROFILE_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(updated),
    patient: updated._id,
    request: meta,
    changes,
  });
  return toDoctorView(updated);
}

// ---- Status --------------------------------------------------------------------------------

/** POST /patients/:id/deactivate | activate (admin), with a reason. */
export async function setPatientActive(
  user: AuthUser,
  id: string,
  isActive: boolean,
  reason: string,
  meta: RequestMeta,
) {
  await assertCanAccessPatient(user, id, 'demographics', meta);
  const res = await Patient.updateOne(
    { _id: id, isActive: !isActive },
    { $set: { isActive, updatedBy: user.id } },
  );
  if (res.matchedCount === 0) {
    await loadPatient(id); // 404 if missing
    throw new ApiError(
      409,
      `Patient is already ${isActive ? 'active' : 'inactive'}`,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
    );
  }
  const updated = await loadPatient(id);
  await audit.record({
    action: isActive ? AUDIT_ACTIONS.PATIENT_ACTIVATE : AUDIT_ACTIONS.PATIENT_DEACTIVATE,
    actor: actorOf(user),
    resource: resourceOf(updated),
    patient: updated._id,
    request: meta,
    changes: audit.diffChanges({ isActive: !isActive }, { isActive }, ['isActive']),
    metadata: { reason },
  });
  await getSettings();
  return toAdminView(updated, await portalInfo(updated._id));
}
