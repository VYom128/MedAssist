import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { ClinicalSummary } from '../../summaries/model.js';
import { links } from '../links.js';
import { defineSource, doctorName, newestFirst, windowFilter, type PersonRef } from '../types.js';

interface Row {
  _id: Types.ObjectId;
  encounter: Types.ObjectId;
  reviewedAt: Date;
  reviewedBy?: PersonRef | null;
}

/**
 * Approved AI clinical summaries (Phase 9) at their approval time: "AI-assisted summary ·
 * reviewed by Dr X". Doctors (the service checks the care relationship) see every approved
 * summary; patients only those the doctor shared. Drafts, rejected, failed and superseded
 * summaries never appear, and items carry no summary text.
 */
export const clinicalSummarySource = defineSource<Row>({
  type: 'clinical_summary',
  rolesAllowed: [ROLES.DOCTOR, ROLES.PATIENT],
  async query(patient, q) {
    return ClinicalSummary.find({
      patient,
      status: 'approved',
      ...(q.viewer.role === ROLES.PATIENT ? { shareWithPatient: true } : {}),
      $and: windowFilter('reviewedAt', 'clinical_summary', q),
    })
      .select('encounter reviewedAt reviewedBy')
      .sort(newestFirst('reviewedAt'))
      .limit(q.limit)
      .populate({ path: 'reviewedBy', select: 'firstName lastName' })
      .lean<Row[]>();
  },
  toItem(s, viewer) {
    const isPatient = viewer.role === ROLES.PATIENT;
    return {
      type: 'clinical_summary',
      id: s._id.toString(),
      at: s.reviewedAt,
      title: isPatient ? 'Visit summary (AI-assisted)' : 'AI-assisted summary',
      subtitle: `Reviewed by ${doctorName(s.reviewedBy)}`,
      status: 'approved',
      link: links.encounter(viewer.role, s.encounter.toString()),
      flags: ['ai_assisted'],
    };
  },
});
