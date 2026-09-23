import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ERROR_CODES, ROLES, type PatientLinkStatus } from '../config/constants.js';
import { nameKeyOf, Patient } from '../modules/patients/model.js';
import { createPatient } from '../modules/patients/service.js';
import { createPatientSchema } from '../modules/patients/validation.js';
import { User } from '../modules/users/model.js';
import * as audit from '../services/audit.service.js';
import { ApiError } from '../utils/ApiError.js';
import { calendarDate } from '../utils/dates.js';
import { counts, SEED_REQUEST, seedActor, type SeedCounts } from './context.js';
import {
  PENDING_MATCH_INDEX,
  PORTAL_PATIENTS,
  patientSeeds,
  type PatientSeed,
} from './data/patients.js';
import { demoAccountState, demoPasswordHash } from './users.js';

/** The self-sign-up waiting for reception to confirm it (matches patient PENDING_MATCH_INDEX). */
export const PENDING_SIGNUP_EMAIL = 'pending1@medassist.dev';

/** Demo logins of the seeded patients: patient1…patient8 (linked) and pending1 (pending). */
export function patientLogins() {
  const seeds = patientSeeds();
  const pending = seeds[PENDING_MATCH_INDEX]!.body;
  return [
    ...seeds.slice(0, PORTAL_PATIENTS).map((s) => ({
      role: ROLES.PATIENT,
      email: s.portalEmail!,
      firstName: s.body.firstName,
      lastName: s.body.lastName,
    })),
    {
      role: ROLES.PATIENT,
      email: PENDING_SIGNUP_EMAIL,
      firstName: pending.firstName,
      lastName: pending.lastName,
    },
  ];
}

/**
 * Upserts a demo patient login with the demo password, linked (or pending) to `patientId`, and
 * makes sure no other record still points at it.
 */
async function upsertPortalUser(
  email: string,
  seed: PatientSeed,
  patientId: Types.ObjectId,
  linkStatus: PatientLinkStatus,
  passwordHash: string,
) {
  const state = demoAccountState(passwordHash);
  const result = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        ...state.$set,
        firstName: seed.body.firstName,
        lastName: seed.body.lastName,
        role: ROLES.PATIENT,
        phone: seed.body.phone,
        dateOfBirth: calendarDate(seed.body.dateOfBirth),
        patient: patientId,
        patientLinkStatus: linkStatus,
      },
      $unset: state.$unset,
      $setOnInsert: { emailVerifiedAt: new Date(), termsAcceptedAt: new Date() },
    },
    { upsert: true, new: true, includeResultMetadata: true, runValidators: true },
  );
  const user = result.value!;
  await Patient.updateMany({ user: user._id, _id: { $ne: patientId } }, { $unset: { user: 1 } });
  await Patient.updateOne(
    { _id: patientId },
    linkStatus === 'linked' ? { $set: { user: user._id } } : { $unset: { user: 1 } },
  );
  const inserted = !result.lastErrorObject?.updatedExisting;
  await audit.record({
    action: inserted ? AUDIT_ACTIONS.USER_CREATE : AUDIT_ACTIONS.USER_UPDATE,
    actor: null, // system
    resource: { type: 'user', id: user._id },
    patient: patientId,
    metadata: { role: ROLES.PATIENT, source: 'seed', linkStatus },
  });
}

/**
 * 60 patients (spec §15.3) registered through the patients service by reception1, so MRNs and
 * audit entries are real; chronic conditions are written directly as recorded by dr.mehta (no
 * care relationships until Phase 5). Existing patients (same name, DOB and phone) are left as
 * they are. Also: portal logins patient1…8 (linked) and pending1 (waiting for reception).
 */
export async function seedPatients(): Promise<SeedCounts> {
  const actor = await seedActor('reception1@medassist.dev', ROLES.RECEPTIONIST);
  const doctor = await User.findOne({ email: 'dr.mehta@medassist.dev' }).lean();
  const passwordHash = await demoPasswordHash();
  const seeds = patientSeeds();
  const result = { ...counts(), portalUsers: 0, pending: 0 };
  const ids: Types.ObjectId[] = [];

  for (const seed of seeds) {
    const input = createPatientSchema.body.parse(seed.body);
    const existing = await Patient.findOne({
      nameKey: nameKeyOf(input.firstName, input.lastName),
      dateOfBirth: input.dateOfBirth,
      phone: input.phone,
    }).lean();
    if (existing) {
      ids.push(existing._id);
      result.unchanged += 1;
      continue;
    }
    let created;
    try {
      created = await createPatient(actor, input, SEED_REQUEST);
    } catch (err) {
      // Someone registered a matching patient by hand: add the demo one anyway.
      if (!(err instanceof ApiError && err.code === ERROR_CODES.DUPLICATE_PATIENT)) throw err;
      created = await createPatient(
        actor,
        { ...input, force: true, reason: 'Demo data from npm run seed' },
        SEED_REQUEST,
      );
    }
    const id = (await Patient.findById(created.id, { _id: 1 }).lean())!._id;
    if (seed.chronicConditions.length > 0) {
      await Patient.updateOne(
        { _id: id },
        {
          $set: {
            chronicConditions: seed.chronicConditions.map((c) => ({
              name: c.name,
              notes: c.notes,
              since: calendarDate(c.since),
              recordedBy: doctor?._id,
              recordedAt: new Date(),
            })),
          },
        },
      );
    }
    ids.push(id);
    result.created += 1;
  }

  for (let i = 0; i < PORTAL_PATIENTS; i++) {
    await upsertPortalUser(seeds[i]!.portalEmail!, seeds[i]!, ids[i]!, 'linked', passwordHash);
    result.portalUsers += 1;
  }
  // Back to "waiting for reception" on every run, so the confirm/reject demo can be repeated.
  await upsertPortalUser(
    PENDING_SIGNUP_EMAIL,
    seeds[PENDING_MATCH_INDEX]!,
    ids[PENDING_MATCH_INDEX]!,
    'pending_verification',
    passwordHash,
  );
  result.pending += 1;
  return result;
}
