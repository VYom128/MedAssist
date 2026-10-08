import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { FollowupRequest } from '../../followups/model.js';
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
  requestNumber: string;
  type: string;
  status: string;
  createdAt: Date;
  assignedDoctor?: PersonRef | null;
}

const TYPE_LABELS: Record<string, string> = {
  question: 'Question',
  new_or_worse_symptoms: 'New or worse symptoms',
  report_review: 'Report review',
  refill_request: 'Refill request',
  reschedule: 'Reschedule',
  other: 'Other',
};

/**
 * Follow-up requests when they were raised (Phase 8): the number, kind and assigned doctor –
 * never the message or the thread, so internal notes cannot leak.
 */
export const followupSource = defineSource<Row>({
  type: 'followup_request',
  rolesAllowed: [ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.PATIENT],
  async query(patient, q) {
    return FollowupRequest.find({ patient, $and: windowFilter('createdAt', 'followup_request', q) })
      .select('requestNumber type status createdAt assignedDoctor')
      .sort(newestFirst('createdAt'))
      .limit(q.limit)
      .populate({ path: 'assignedDoctor', select: 'firstName lastName' })
      .lean<Row[]>();
  },
  toItem(r, viewer) {
    const id = r._id.toString();
    return {
      type: 'followup_request',
      id,
      at: r.createdAt,
      title: `Follow-up request ${r.requestNumber}`,
      subtitle: joinParts(
        TYPE_LABELS[r.type] ?? r.type,
        r.assignedDoctor ? doctorName(r.assignedDoctor) : null,
      ),
      status: r.status,
      link: links.followup(viewer.role, id),
      flags: [],
    };
  },
});
