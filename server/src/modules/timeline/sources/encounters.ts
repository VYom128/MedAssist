import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { Encounter } from '../../encounters/model.js';
import { sharedPrimaryDiagnosis } from '../../encounters/serializer.js';
import { links } from '../links.js';
import {
  defineSource,
  doctorName,
  joinParts,
  newestFirst,
  windowFilter,
  type PersonRef,
} from '../types.js';

interface Row {
  _id: Types.ObjectId;
  encounterNumber: string;
  signedAt: Date;
  status: string;
  doctor?: PersonRef | null;
  diagnoses?: { description: string; isPrimary?: boolean | null }[];
  shareDiagnosisWithPatient?: boolean | null;
  followUp?: { required?: boolean | null } | null;
}

/**
 * Signed (or amended) notes at their signing time – never drafts, not even the viewer's own.
 * Doctors see the primary diagnosis; patients only a diagnosis the doctor shared.
 */
export const encounterSource = defineSource<Row>({
  type: 'encounter',
  rolesAllowed: [ROLES.DOCTOR, ROLES.PATIENT],
  async query(patient, q) {
    return Encounter.find({
      patient,
      status: { $in: ['signed', 'amended'] },
      $and: windowFilter('signedAt', 'encounter', q),
    })
      .select(
        'encounterNumber signedAt status doctor diagnoses shareDiagnosisWithPatient followUp.required',
      )
      .sort(newestFirst('signedAt'))
      .limit(q.limit)
      .populate({ path: 'doctor', select: 'firstName lastName' })
      .lean<Row[]>();
  },
  toItem(e, viewer) {
    const id = e._id.toString();
    const isPatient = viewer.role === ROLES.PATIENT;
    const primary = (e.diagnoses ?? []).find((d) => d.isPrimary) ?? e.diagnoses?.[0];
    const diagnosis = isPatient ? sharedPrimaryDiagnosis(e) : (primary?.description ?? null);
    const flags: string[] = [];
    if (e.status === 'amended') flags.push('amended');
    if (e.followUp?.required) flags.push('follow_up_planned');
    return {
      type: 'encounter',
      id,
      at: e.signedAt,
      title: isPatient ? 'Visit summary' : `Clinical note ${e.encounterNumber}`,
      subtitle: joinParts(doctorName(e.doctor), diagnosis),
      status: e.status,
      link: links.encounter(viewer.role, id),
      flags,
    };
  },
});
