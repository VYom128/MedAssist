import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { ISSUED_STATUSES } from '../../../policies/prescriptionAccess.js';
import { Prescription } from '../../prescriptions/model.js';
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
  prescriptionNumber?: string | null;
  issuedAt: Date;
  status: string;
  encounter: Types.ObjectId;
  doctor?: PersonRef | null;
  items?: unknown[];
}

const plural = (n: number) => `${n} ${n === 1 ? 'medicine' : 'medicines'}`;

/**
 * Prescriptions at their issue time: doctors every issued one (incl. cancelled), patients their
 * issued and completed ones. Drafts never. Drug names stay on the prescription page.
 */
export const prescriptionSource = defineSource<Row>({
  type: 'prescription',
  rolesAllowed: [ROLES.DOCTOR, ROLES.PATIENT],
  async query(patient, q) {
    const status =
      q.viewer.role === ROLES.PATIENT ? { $in: ISSUED_STATUSES } : { $ne: 'draft' as const };
    return Prescription.find({
      patient,
      status,
      $and: windowFilter('issuedAt', 'prescription', q),
    })
      .select('prescriptionNumber issuedAt status encounter doctor items._id')
      .sort(newestFirst('issuedAt'))
      .limit(q.limit)
      .populate({ path: 'doctor', select: 'firstName lastName' })
      .lean<Row[]>();
  },
  toItem(p, viewer) {
    const id = p._id.toString();
    return {
      type: 'prescription',
      id,
      at: p.issuedAt,
      title: `Prescription ${p.prescriptionNumber ?? ''}`.trim(),
      subtitle: joinParts(doctorName(p.doctor), plural((p.items ?? []).length)),
      status: p.status,
      link: links.prescription(viewer.role, id, p.encounter.toString()),
      flags: [],
    };
  },
});
