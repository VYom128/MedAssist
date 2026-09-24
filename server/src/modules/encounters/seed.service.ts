import type { Types } from 'mongoose';
import { AUDIT_ACTIONS, SEQUENCES } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import type { AuthUser } from '../../types/express.js';
import { clinicToday, toClinicDate } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { withTransaction } from '../../utils/transaction.js';
import { getSettings } from '../settings/service.js';
import { Prescription } from '../prescriptions/model.js';
import { Encounter } from './model.js';
import { computeBmi } from './vitals.js';

/**
 * SEED ONLY (`npm run seed`): a SIGNED note for a past completed appointment, with an issued
 * prescription, written directly in one transaction. It skips the 72-hour documentation window
 * and the draft → sign flow, which only make sense in real time. Callers validate the note and
 * items with the API's Zod schemas first (seed/encounters.ts). Never call it from a route.
 */
export interface SeedSignedNoteInput {
  appointment: {
    _id: Types.ObjectId;
    patient: Types.ObjectId;
    doctor: Types.ObjectId;
    startAt: Date;
  };
  doctor: AuthUser;
  signedAt: Date;
  note: Record<string, unknown> & { vitals?: Record<string, number | null | undefined> };
  prescription?: { items: Record<string, unknown>[]; generalInstructions?: string | null } | null;
  request: RequestMeta;
}

export async function insertSignedNoteForSeed(input: SeedSignedNoteInput) {
  const { appointment: appt, doctor, signedAt, note, prescription, request } = input;
  const { timezone } = await getSettings();
  const year = Number(toClinicDate(appt.startAt, timezone).slice(0, 4));
  const vitals = note.vitals
    ? {
        ...note.vitals,
        bmi: computeBmi(note.vitals.weightKg, note.vitals.heightCm) ?? undefined,
        recordedAt: appt.startAt,
        recordedBy: doctor.id,
      }
    : undefined;

  const created = await withTransaction(async (session) => {
    const encSeq = await nextSequence(`${SEQUENCES.ENCOUNTER.key}:${year}`, { session });
    const [encounter] = await Encounter.create(
      [
        {
          ...note,
          ...(vitals ? { vitals } : {}),
          encounterNumber: formatNumber(SEQUENCES.ENCOUNTER.prefix, encSeq, { year }),
          appointment: appt._id,
          patient: appt.patient,
          doctor: appt.doctor,
          visitAt: appt.startAt,
          status: 'signed',
          version: 1,
          signedAt,
          signedBy: doctor.id,
          createdBy: doctor.id,
          updatedBy: doctor.id,
        },
      ],
      { session },
    );
    let rx: { _id: Types.ObjectId; prescriptionNumber?: string | null } | null = null;
    if (prescription && prescription.items.length > 0) {
      const rxYear = Number(clinicToday(timezone, signedAt).slice(0, 4));
      const rxSeq = await nextSequence(`${SEQUENCES.PRESCRIPTION.key}:${rxYear}`, { session });
      const [doc] = await Prescription.create(
        [
          {
            encounter: encounter!._id,
            appointment: appt._id,
            patient: appt.patient,
            doctor: appt.doctor,
            status: 'issued',
            prescriptionNumber: formatNumber(SEQUENCES.PRESCRIPTION.prefix, rxSeq, {
              year: rxYear,
            }),
            items: prescription.items,
            ...(prescription.generalInstructions
              ? { generalInstructions: prescription.generalInstructions }
              : {}),
            issuedAt: signedAt,
            issuedBy: doctor.id,
            createdBy: doctor.id,
            updatedBy: doctor.id,
          },
        ],
        { session },
      );
      rx = doc!;
    }
    return { encounter: encounter!, prescription: rx };
  });

  await audit.record({
    action: AUDIT_ACTIONS.ENCOUNTER_SIGN,
    actor: actorOf(doctor),
    resource: {
      type: 'encounter',
      id: created.encounter._id,
      number: created.encounter.encounterNumber,
    },
    patient: appt.patient,
    request,
    metadata: { via: 'seed', prescriptionIssued: created.prescription !== null },
  });
  if (created.prescription) {
    await audit.record({
      action: AUDIT_ACTIONS.PRESCRIPTION_ISSUE,
      actor: actorOf(doctor),
      resource: {
        type: 'prescription',
        id: created.prescription._id,
        number: created.prescription.prescriptionNumber ?? undefined,
      },
      patient: appt.patient,
      request,
      metadata: { via: 'seed' },
    });
  }
  return {
    encounterId: created.encounter._id,
    prescriptionId: created.prescription?._id ?? null,
  };
}
