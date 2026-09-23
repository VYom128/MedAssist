import { Types, type ClientSession } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  ROLES,
  type PatientLinkStatus,
} from '../../config/constants.js';
import { assertCanAccessPatient } from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import { emailService, sendInBackground } from '../../services/email.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { calendarDateString } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { hashPassword } from '../../utils/password.js';
import { tryNormalisePhone } from '../../utils/phone.js';
import { actorOf, type AuditActor, type RequestMeta } from '../../utils/requestContext.js';
import { withTransaction } from '../../utils/transaction.js';
import { getSettings } from '../settings/service.js';
import { User } from '../users/model.js';
import { createAccountWithSetupLink, type UserWithId } from '../users/service.js';
import { Patient } from './model.js';
import { toPatientSelfView, type PatientLike } from './serializer.js';
import { insertPatient, loadPatient, patientChanges, viewFor } from './service.js';
import type { UpdateMyRecordInput } from './validation.js';

/**
 * Patient portal accounts (spec §4.3 step 5, §4.4): self-signup linking, reception's identity
 * check (confirm / reject), portal invitations and the patient's own record (/patients/me).
 */

const resourceOf = (p: Pick<PatientLike, '_id' | 'mrn'>) => ({
  type: 'patient',
  id: p._id,
  number: p.mrn,
});

const userActor = (u: Pick<UserWithId, '_id' | 'role' | 'firstName' | 'lastName'>): AuditActor => ({
  user: u._id.toString(),
  role: u.role,
  name: `${u.firstName} ${u.lastName}`,
});

const isDuplicateKey = (err: unknown, key: string) =>
  (err as { code?: number }).code === 11000 &&
  Object.keys((err as { keyPattern?: object }).keyPattern ?? {}).includes(key);

// ---- Self-signup linking (spec §4.4) -------------------------------------------------------

export interface SelfSignupInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: Date;
  password: string;
  consent: {
    dataProcessing: true;
    aiExplanations?: boolean;
    communications?: { email?: boolean; sms?: boolean };
  };
}

/**
 * Shown when the phone + DOB match a patient who already has a portal account. Deliberately
 * generic: it must not reveal whether this person is a patient of the clinic.
 */
export const SIGNUP_REJECTED_MESSAGE =
  "We couldn't create your account. Please contact the clinic.";
const signupRejected = () => ApiError.unprocessable(SIGNUP_REJECTED_MESSAGE);

/** What the client shows after sign-up. */
export const LINK_MESSAGES: Record<PatientLinkStatus, string> = {
  linked: 'Your account is ready.',
  pending_verification:
    'Your account has been created. To protect your records, the clinic will confirm your ' +
    'identity at your next visit – please bring a photo ID. Until then you will not see any records.',
};

/** Consent as stored on a Patient, from a sign-up. */
const consentOf = (c: SelfSignupInput['consent'], at: Date) => ({
  dataProcessing: { given: true, at },
  aiExplanations: { given: c.aiExplanations ?? true, at },
  communications: { email: c.communications?.email ?? true, sms: c.communications?.sms ?? false },
});

/**
 * Creates the patient user of a self-registration and links it (spec §4.4), in one transaction:
 * - no Patient with the same phone + DOB → a new Patient, linked;
 * - a match without a portal account → the user points at it, `pending_verification` (no access
 *   until reception confirms their identity);
 * - every match already has a portal account (linked or pending) → 422 with a generic message.
 * @throws 409 for a taken email; 422 SIGNUP_REJECTED_MESSAGE as above.
 */
export async function registerPatientAccount(input: SelfSignupInput, meta: RequestMeta) {
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  let matchedId: Types.ObjectId | null = null;

  try {
    const result = await withTransaction(async (session) => {
      matchedId = null;
      const matches = await Patient.find(
        { phone: input.phone, dateOfBirth: input.dateOfBirth },
        { _id: 1, user: 1 },
      )
        .sort({ createdAt: 1 })
        .session(session)
        .lean();
      let candidate: Types.ObjectId | null = null;
      for (const m of matches) {
        const taken =
          m.user || (await User.exists({ patient: m._id, role: ROLES.PATIENT }).session(session));
        if (!taken) {
          candidate = m._id;
          break;
        }
      }
      if (matches.length > 0 && !candidate) {
        matchedId = matches[0]!._id;
        throw signupRejected();
      }

      const [user] = await User.create(
        [
          {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            dateOfBirth: input.dateOfBirth,
            termsAcceptedAt: now,
            passwordHash,
            role: ROLES.PATIENT,
            lastLoginAt: now,
            ...(candidate ? { patient: candidate, patientLinkStatus: 'pending_verification' } : {}),
          },
        ],
        { session },
      );
      if (candidate) {
        return { user: user!.toObject() as UserWithId, patient: null, candidate };
      }
      const patient = await insertPatient(
        {
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: input.dateOfBirth,
          gender: 'unknown', // not asked at sign-up; reception completes it
          phone: input.phone,
          email: input.email,
          consent: consentOf(input.consent, now),
          user: user!._id,
          registeredBy: user!._id,
          updatedBy: user!._id,
        } as never,
        { session },
      );
      await User.updateOne(
        { _id: user!._id },
        { $set: { patient: patient._id, patientLinkStatus: 'linked' } },
        { session },
      );
      const linked = { ...(user!.toObject() as UserWithId), patient: patient._id };
      return {
        user: { ...linked, patientLinkStatus: 'linked' as const },
        patient,
        candidate: null,
      };
    });

    const linkStatus: PatientLinkStatus = result.patient ? 'linked' : 'pending_verification';
    if (result.patient) {
      await audit.record({
        action: AUDIT_ACTIONS.PATIENT_CREATE,
        actor: userActor(result.user),
        resource: resourceOf(result.patient),
        patient: result.patient._id,
        request: meta,
        metadata: { source: 'self_signup' },
      });
    }
    return {
      user: result.user,
      linkStatus,
      patientId: (result.patient?._id ?? result.candidate)!,
    };
  } catch (err) {
    if (isDuplicateKey(err, 'email')) {
      throw ApiError.conflict('An account with this email already exists', { fields: ['email'] });
    }
    // Two sign-ups racing for the same unlinked record: the unique users.patient index wins.
    const rejected =
      isDuplicateKey(err, 'patient') ||
      (err instanceof ApiError && err.message === SIGNUP_REJECTED_MESSAGE);
    if (rejected) {
      await audit.record({
        action: AUDIT_ACTIONS.AUTH_REGISTER,
        outcome: 'failure',
        request: meta,
        patient: matchedId,
        metadata: { email: input.email, reason: 'matched_patient_has_account' },
      });
      throw signupRejected();
    }
    throw err;
  }
}

// ---- The patient's own record (/patients/me) -----------------------------------------------

const linkPending = () =>
  new ApiError(
    403,
    'Your account is waiting for the clinic to confirm your identity. Please bring a photo ID to ' +
      'your next visit; your records will appear once it is confirmed.',
    ERROR_CODES.PATIENT_LINK_PENDING,
  );

/** The caller's linked record id: 403 PATIENT_LINK_PENDING while pending, 404 if none. */
async function myPatientId(user: AuthUser): Promise<string> {
  if (user.patientId) return user.patientId;
  const account = await User.findById(user.id).select('patientLinkStatus').lean();
  if (account?.patientLinkStatus === 'pending_verification') throw linkPending();
  throw ApiError.notFound('No patient record is linked to this account');
}

/** GET /patients/me – audited as `patient.view` (debounced). */
export async function getMyRecord(user: AuthUser, meta: RequestMeta) {
  const id = await myPatientId(user);
  await assertCanAccessPatient(user, id, 'demographics', meta);
  const p = await loadPatient(id);
  await getSettings();
  await audit.recordRead({
    action: AUDIT_ACTIONS.PATIENT_VIEW,
    actor: actorOf(user),
    resource: resourceOf(p),
    patient: p._id,
    request: meta,
  });
  return toPatientSelfView(p);
}

/**
 * PATCH /patients/me – contact details, emergency contact, preferred language, AI and
 * communication consents. Name, DOB and gender are changed by reception. Audited
 * (`patient.update`, `metadata.via: 'portal'`).
 */
export async function updateMyRecord(
  user: AuthUser,
  input: UpdateMyRecordInput,
  meta: RequestMeta,
) {
  const id = await myPatientId(user);
  await assertCanAccessPatient(user, id, 'demographics', meta);
  const before = await loadPatient(id);
  const { consent, ...fields } = input;
  const now = new Date();

  // Consents are diffed one by one under flat names (audit keys cannot contain dots).
  const beforeValues: Record<string, unknown> = {
    ...before,
    consentAiExplanations: before.consent?.aiExplanations?.given ?? false,
    consentCommunications: before.consent?.communications ?? null,
  };
  const next: Record<string, unknown> = { ...fields };
  const set: Record<string, unknown> = { ...fields };
  if (consent?.aiExplanations !== undefined) {
    next.consentAiExplanations = consent.aiExplanations;
    set['consent.aiExplanations'] = { given: consent.aiExplanations, at: now };
  }
  if (consent?.communications) {
    const merged = {
      email: before.consent?.communications?.email ?? true,
      sms: before.consent?.communications?.sms ?? false,
      ...Object.fromEntries(
        Object.entries(consent.communications).filter(([, v]) => v !== undefined),
      ),
    };
    next.consentCommunications = merged;
    set['consent.communications'] = merged;
  }

  const changes = patientChanges(beforeValues, { ...beforeValues, ...next }, Object.keys(next));
  await getSettings();
  if (changes.fields.length === 0) return toPatientSelfView(before);
  // Only the changed consents get a new timestamp.
  if (!changes.fields.includes('consentAiExplanations')) delete set['consent.aiExplanations'];

  await Patient.updateOne(
    { _id: id },
    { $set: { ...set, updatedBy: user.id } },
    { runValidators: true },
  );
  const updated = await loadPatient(id);
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(updated),
    patient: updated._id,
    request: meta,
    changes,
    metadata: { via: 'portal' },
  });
  return toPatientSelfView(updated);
}

// ---- Reception: pending links --------------------------------------------------------------

/** GET /patients/pending-links – self-registered users waiting for an identity check. */
export async function listPendingLinks({ page, limit, skip }: Pagination) {
  const filter = { role: ROLES.PATIENT, patientLinkStatus: 'pending_verification' };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const patients = await Patient.find({ _id: { $in: users.map((u) => u.patient) } }).lean();
  const byId = new Map(patients.map((p) => [p._id.toString(), p as PatientLike]));
  const items = users.map((u) => {
    const p = u.patient ? byId.get(u.patient.toString()) : undefined;
    return {
      userId: u._id.toString(),
      isActive: u.isActive,
      signup: {
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone ?? null,
        dateOfBirth: u.dateOfBirth ? calendarDateString(u.dateOfBirth) : null,
        registeredAt: (u as { createdAt?: Date }).createdAt ?? null,
      },
      patient: p
        ? {
            id: p._id.toString(),
            mrn: p.mrn,
            fullName: `${p.firstName} ${p.lastName}`,
            dateOfBirth: calendarDateString(p.dateOfBirth),
            phone: p.phone,
            isActive: p.isActive,
          }
        : null,
    };
  });
  return { items, meta: buildMeta({ page, limit, total }) };
}

/** The pending user waiting on patient `patientId`, or 404. */
async function findPendingUser(patientId: string, userId: string, session?: ClientSession) {
  const user = (await User.findOne({
    _id: userId,
    role: ROLES.PATIENT,
    patient: patientId,
    patientLinkStatus: 'pending_verification',
  })
    .session(session ?? null)
    .lean()) as UserWithId | null;
  if (!user) throw ApiError.notFound('No pending link between this patient and user');
  return user;
}

const alreadyHasAccount = () =>
  ApiError.conflict('This patient record already has a portal account');

/**
 * POST /patients/:id/confirm-link (receptionist, after checking ID) – the user gets access to
 * the record. Emails them that their records are available. Audited `patient.link_confirm`.
 */
export async function confirmLink(
  user: AuthUser,
  patientId: string,
  userId: string,
  meta: RequestMeta,
) {
  await assertCanAccessPatient(user, patientId, 'demographics', meta);
  const patient = await loadPatient(patientId);
  const account = await withTransaction(async (session) => {
    const pending = await findPendingUser(patientId, userId, session);
    const claimed = await Patient.updateOne(
      { _id: patientId, user: { $not: { $type: 'objectId' } } },
      { $set: { user: pending._id, updatedBy: user.id } },
      { session },
    );
    if (claimed.matchedCount === 0) throw alreadyHasAccount();
    await User.updateOne(
      { _id: pending._id },
      { $set: { patientLinkStatus: 'linked', updatedBy: user.id } },
      { session },
    );
    return pending;
  });
  sendInBackground(
    () => emailService.sendPatientRecordsLinked(account.email, account.firstName),
    'patient_records_linked',
  );
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_LINK_CONFIRM,
    actor: actorOf(user),
    resource: resourceOf(patient),
    patient: patient._id,
    request: meta,
    metadata: { userId: account._id.toString() },
  });
  await getSettings();
  return viewFor(user, await loadPatient(patientId));
}

/**
 * POST /patients/:id/reject-link (receptionist) – the person is not this patient (e.g. a twin
 * sharing the phone): a new, separate Patient is created from their sign-up details (new MRN)
 * and linked to them. Audited `patient.link_reject` (on the original record) and
 * `patient.create` (the new one).
 */
export async function rejectLink(
  user: AuthUser,
  patientId: string,
  userId: string,
  reason: string,
  meta: RequestMeta,
) {
  await assertCanAccessPatient(user, patientId, 'demographics', meta);
  const original = await loadPatient(patientId);
  const signup = await findPendingUser(patientId, userId);
  const phone = signup.phone ? tryNormalisePhone(signup.phone) : null;
  if (!phone || !signup.dateOfBirth) {
    throw ApiError.unprocessable('The sign-up has no phone number or date of birth to copy');
  }
  const now = new Date();

  const created = await withTransaction(async (session) => {
    const pending = await findPendingUser(patientId, userId, session);
    const patient = await insertPatient(
      {
        firstName: pending.firstName,
        lastName: pending.lastName,
        dateOfBirth: pending.dateOfBirth,
        gender: 'unknown',
        phone,
        email: pending.email,
        consent: {
          dataProcessing: { given: true, at: pending.termsAcceptedAt ?? now },
          aiExplanations: { given: true, at: pending.termsAcceptedAt ?? now },
        },
        user: pending._id,
        registeredBy: new Types.ObjectId(user.id),
        updatedBy: new Types.ObjectId(user.id),
      } as never,
      { session },
    );
    await User.updateOne(
      { _id: pending._id },
      { $set: { patient: patient._id, patientLinkStatus: 'linked', updatedBy: user.id } },
      { session },
    );
    return patient;
  });

  sendInBackground(
    () => emailService.sendPatientRecordsLinked(signup.email, signup.firstName),
    'patient_records_linked',
  );
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_LINK_REJECT,
    actor: actorOf(user),
    resource: resourceOf(original),
    patient: original._id,
    request: meta,
    metadata: {
      reason,
      userId: signup._id.toString(),
      newPatientId: created._id.toString(),
      newMrn: created.mrn,
    },
  });
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: created._id,
    request: meta,
    metadata: { source: 'link_reject', rejectedMrn: original.mrn },
  });
  await getSettings();
  return viewFor(user, created);
}

// ---- Portal invite (spec §4.3 step 5) ------------------------------------------------------

/**
 * POST /patients/:id/portal-invite – creates a patient user linked to this record and emails a
 * "set your password" link (72 h). The record needs an email and no portal account yet.
 * @param sendEmail false for the seed (demo passwords instead of links).
 */
export async function inviteToPortal(
  user: AuthUser,
  patientId: string,
  meta: RequestMeta,
  { sendEmail = true }: { sendEmail?: boolean } = {},
) {
  await assertCanAccessPatient(user, patientId, 'demographics', meta);
  const patient = await loadPatient(patientId);
  if (!patient.isActive) throw ApiError.unprocessable('This patient record is inactive');
  if (!patient.email) {
    throw ApiError.unprocessable('Add an email address to the patient record first', [
      { field: 'email', message: 'Required for a portal account' },
    ]);
  }

  const { account, token } = await withTransaction(async (session) => {
    if (patient.user || (await User.exists({ patient: patientId }).session(session))) {
      throw alreadyHasAccount();
    }
    const { user: created, token } = await createAccountWithSetupLink(
      user,
      {
        firstName: patient.firstName,
        lastName: patient.lastName,
        email: patient.email!,
        phone: patient.phone,
        role: ROLES.PATIENT,
        dateOfBirth: patient.dateOfBirth,
        patient: patient._id,
        patientLinkStatus: 'linked',
      },
      { session, mustChangePassword: false },
    );
    const claimed = await Patient.updateOne(
      { _id: patientId, user: { $not: { $type: 'objectId' } } },
      { $set: { user: created._id, updatedBy: user.id } },
      { session },
    );
    if (claimed.matchedCount === 0) throw alreadyHasAccount();
    return { account: created, token };
  }).catch((err: unknown) => {
    if (isDuplicateKey(err, 'email')) {
      throw ApiError.conflict('An account with this email already exists', { fields: ['email'] });
    }
    throw err;
  });

  if (sendEmail) {
    sendInBackground(
      () => emailService.sendPatientPortalInvite(account.email, account.firstName, token),
      'patient_portal_invite',
    );
  }
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_PORTAL_INVITE,
    actor: actorOf(user),
    resource: resourceOf(patient),
    patient: patient._id,
    request: meta,
    metadata: { userId: account._id.toString() },
  });
  await getSettings();
  return viewFor(user, await loadPatient(patientId));
}
