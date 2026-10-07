import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { documentListFilter } from '../../../policies/documentAccess.js';
import { Document } from '../../documents/model.js';
import { links } from '../links.js';
import { defineSource, newestFirst, windowFilter } from '../types.js';

interface Row {
  _id: Types.ObjectId;
  patient: Types.ObjectId;
  title: string;
  category: string;
  createdAt: Date;
  isGenerated?: boolean | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  lab_report: 'Lab report',
  prescription: 'Prescription',
  visit_summary: 'Visit summary',
  invoice: 'Invoice',
  referral: 'Referral',
  imaging: 'Imaging',
  id_proof: 'ID proof',
  insurance: 'Insurance',
  other: 'Other',
};

/**
 * Documents when they were added, filtered by the Phase 6 rules per role (documentListFilter):
 * reception non-clinical categories only, patients documents visible to them.
 */
export const documentSource = defineSource<Row>({
  type: 'document',
  rolesAllowed: [ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.PATIENT],
  async query(patient, q) {
    const allowed = await documentListFilter(q.viewer, patient.toString());
    return Document.find({ $and: [allowed, ...windowFilter('createdAt', 'document', q)] })
      .select('patient title category createdAt isGenerated')
      .sort(newestFirst('createdAt'))
      .limit(q.limit)
      .lean<Row[]>();
  },
  toItem(d, viewer) {
    return {
      type: 'document',
      id: d._id.toString(),
      at: d.createdAt,
      title: d.title,
      subtitle: CATEGORY_LABELS[d.category] ?? d.category,
      status: null,
      link: links.documents(viewer.role, d.patient.toString()),
      flags: d.isGenerated ? ['generated'] : [],
    };
  },
});
