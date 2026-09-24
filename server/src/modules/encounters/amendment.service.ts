import { isDeepStrictEqual } from 'node:util';
import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, ENCOUNTER_EDITABLE_FIELDS } from '../../config/constants.js';
import { assertCanReadEncounter, assertCanWriteEncounter } from '../../policies/encounterAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { calendarDateString } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { User } from '../users/model.js';
import { NoteAmendment } from './amendment.model.js';
import { amendmentWriteOptions, Encounter } from './model.js';
import { ENCOUNTER_POPULATE, toDoctorView, type EncounterLike } from './serializer.js';
import { buildNoteUpdate, loadEncounter, resourceOf } from './service.js';
import type { UpdateEncounterInput } from './validation.js';

type Changes = Omit<UpdateEncounterInput, 'expectedVersion'>;

/** A note field as a plain JSON value, for comparing and for the amendment snapshot. */
function snapshotOf(e: Partial<EncounterLike>, field: string): unknown {
  const value = (e as Record<string, unknown>)[field];
  if (value === undefined || value === null) return null;
  if (field === 'vitals') {
    const { recordedAt: _a, recordedBy: _b, ...vitals } = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(vitals).filter(([, v]) => v !== null && v !== undefined),
    );
  }
  if (field === 'followUp') {
    const f = value as {
      required?: boolean;
      afterDays?: number;
      date?: Date;
      instructions?: string;
    };
    return {
      required: f.required ?? false,
      afterDays: f.afterDays ?? null,
      date: f.date ? calendarDateString(f.date) : null,
      instructions: f.instructions ?? null,
    };
  }
  if (field === 'diagnoses') {
    return (value as Record<string, unknown>[]).map((d) => ({
      description: d.description,
      icd10Code: d.icd10Code ?? null,
      type: d.type ?? 'provisional',
      isPrimary: d.isPrimary ?? false,
    }));
  }
  return value;
}

/**
 * POST /encounters/:id/amendments (spec §6.14, §8.5) – corrects a signed note with a reason
 * (≥ 10 characters). In one transaction: the note gets the changes (status 'amended', version +1,
 * lastAmendedAt) through the internal amendment write path, and a `note_amendments` entry keeps
 * the reason and the changed fields before and after. Only the note's doctor; no time limit.
 * Changes that change nothing → 422. Audited `encounter.amend` with field names only.
 */
export async function amendEncounter(
  user: AuthUser,
  id: string,
  { reason, changes }: { reason: string; changes: Changes },
  meta: RequestMeta,
) {
  const e = await loadEncounter(id);
  await assertCanWriteEncounter(user, e, meta);
  assertTransition('encounter', e.status, 'amended');

  const now = new Date();
  const { $set, $unset } = buildNoteUpdate(e, changes, user.id, now);
  // What the note would look like, to find the fields that really change.
  const candidate = await Encounter.hydrate({ ...e, doctor: e.doctor._id, patient: e.patient._id });
  for (const [path, value] of Object.entries($set)) candidate.set(path, value);
  for (const path of Object.keys($unset)) candidate.set(path, undefined);
  const after = candidate.toObject() as unknown as EncounterLike;

  const changedFields = ENCOUNTER_EDITABLE_FIELDS.filter(
    (f) => changes[f] !== undefined && !isDeepStrictEqual(snapshotOf(e, f), snapshotOf(after, f)),
  );
  if (changedFields.length === 0) {
    throw ApiError.unprocessable('These changes are the same as the signed note');
  }
  const before = Object.fromEntries(changedFields.map((f) => [f, snapshotOf(e, f)]));
  const afterSnapshot = Object.fromEntries(changedFields.map((f) => [f, snapshotOf(after, f)]));
  // Vitals are stamped only when they change.
  if (!changedFields.includes('vitals')) {
    for (const key of Object.keys($set)) if (key.startsWith('vitals.')) delete $set[key];
    for (const key of Object.keys($unset)) if (key.startsWith('vitals.')) delete $unset[key];
  }
  const version = e.version + 1;

  try {
    await withTransaction(async (session) => {
      const updated = await Encounter.findOneAndUpdate(
        { _id: e._id, status: e.status, version: e.version },
        {
          $set: { ...$set, status: 'amended', lastAmendedAt: now, updatedBy: user.id },
          ...(Object.keys($unset).length > 0 ? { $unset } : {}),
          $inc: { version: 1, __v: 1 },
        },
        { ...amendmentWriteOptions(session), new: true, runValidators: true },
      ).lean();
      if (!updated) {
        throw ApiError.conflict('This note was amended at the same time. Reload it and try again.');
      }
      await NoteAmendment.create(
        [
          {
            encounter: e._id,
            version,
            reason,
            changedFields,
            before,
            after: afterSnapshot,
            amendedBy: user.id,
          },
        ],
        { session },
      );
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict('This note was amended at the same time. Reload it and try again.');
    }
    throw err;
  }

  await audit.record({
    action: AUDIT_ACTIONS.ENCOUNTER_AMEND,
    actor: actorOf(user),
    resource: resourceOf(e),
    patient: e.patient._id,
    request: meta,
    changes: { fields: [...changedFields] },
    metadata: { version },
  });
  const amended = await Encounter.findById(e._id)
    .populate([...ENCOUNTER_POPULATE])
    .lean();
  return toDoctorView(amended as unknown as EncounterLike);
}

/**
 * GET /encounters/:id/amendments – the version history of a note, oldest first (readers of the
 * note: its doctor, or doctors with a care relationship once signed). Audited as a read of the
 * note (`encounter.view`, debounced).
 */
export async function listAmendments(user: AuthUser, id: string, meta: RequestMeta) {
  const e = await loadEncounter(id);
  await assertCanReadEncounter(user, e, meta);
  const entries = await NoteAmendment.find({ encounter: e._id }).sort({ version: 1 }).lean();
  const authors = await User.find({ _id: { $in: entries.map((a) => a.amendedBy) } })
    .select('firstName lastName')
    .lean();
  const nameOf = (uid: Types.ObjectId) => {
    const u = authors.find((a) => a._id.equals(uid));
    return u ? `${u.firstName} ${u.lastName}` : null;
  };
  await audit.recordRead({
    action: AUDIT_ACTIONS.ENCOUNTER_VIEW,
    actor: actorOf(user),
    resource: resourceOf(e),
    patient: e.patient._id,
    request: meta,
  });
  return {
    encounterId: e._id.toString(),
    currentVersion: e.version,
    signedAt: e.signedAt ?? null,
    amendments: entries.map((a) => ({
      id: a._id.toString(),
      version: a.version,
      reason: a.reason,
      changedFields: a.changedFields,
      before: a.before,
      after: a.after,
      amendedBy: { id: a.amendedBy.toString(), name: nameOf(a.amendedBy) },
      amendedAt: a.createdAt,
    })),
  };
}
