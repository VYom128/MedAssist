import type { ClientSession, Types } from 'mongoose';
import { SEQUENCES } from '../../config/constants.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { Encounter } from './model.js';

type Ref = Types.ObjectId | { _id: Types.ObjectId };
const idOf = (ref: Ref) => ('_id' in ref ? ref._id : ref);

/**
 * The draft encounter of an appointment, created if missing (spec §4.7 step 1: idempotent).
 * Called inside the transaction that moves the appointment into consultation, so the note and
 * the status change commit together. That transaction holds the doctor's booking lock, and the
 * unique index on `appointment` is the last guard, so parallel starts create one note.
 * The number (ENC-<year>-000001) is taken only when a note is created.
 */
export async function ensureEncounterDraft(
  appt: { _id: Types.ObjectId; patient: Ref; doctor: Ref; startAt: Date },
  { by, year, session }: { by: string; year: number; session: ClientSession },
): Promise<{ id: Types.ObjectId; encounterNumber: string; created: boolean }> {
  const existing = await Encounter.findOne({ appointment: appt._id })
    .select('encounterNumber')
    .session(session)
    .lean();
  if (existing) {
    return { id: existing._id, encounterNumber: existing.encounterNumber, created: false };
  }
  const seq = await nextSequence(`${SEQUENCES.ENCOUNTER.key}:${year}`, { session });
  const [doc] = await Encounter.create(
    [
      {
        encounterNumber: formatNumber(SEQUENCES.ENCOUNTER.prefix, seq, { year }),
        appointment: appt._id,
        patient: idOf(appt.patient),
        doctor: idOf(appt.doctor),
        visitAt: appt.startAt,
        createdBy: by,
        updatedBy: by,
      },
    ],
    { session },
  );
  return { id: doc!._id, encounterNumber: doc!.encounterNumber, created: true };
}
