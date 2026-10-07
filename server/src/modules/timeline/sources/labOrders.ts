import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { PLACED_LAB_ORDER } from '../../../policies/patientAccess.js';
import { LabOrder } from '../../labOrders/model.js';
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
  orderNumber?: string | null;
  orderedAt?: Date | null;
  releasedAt?: Date | null;
  status: string;
  priority?: string | null;
  hasCritical?: boolean | null;
  orderedBy?: PersonRef | null;
  items?: { status?: string | null; testSnapshot?: { name?: string } | null }[];
}

/** Doctors see placed orders when they were ordered; patients released orders when released. */
const timeField = (role: string) => (role === ROLES.PATIENT ? 'releasedAt' : 'orderedAt');

/**
 * Lab orders: doctors every placed order (with its status, urgent/critical flags); patients
 * their released orders only – no flags or values (the report has them).
 */
export const labOrderSource = defineSource<Row>({
  type: 'lab_order',
  rolesAllowed: [ROLES.DOCTOR, ROLES.PATIENT],
  async query(patient, q) {
    const field = timeField(q.viewer.role);
    const visible = q.viewer.role === ROLES.PATIENT ? { status: 'released' } : PLACED_LAB_ORDER;
    return LabOrder.find({ patient, ...visible, $and: windowFilter(field, 'lab_order', q) })
      .select(
        'orderNumber orderedAt releasedAt status priority hasCritical orderedBy items.status items.testSnapshot.name',
      )
      .sort(newestFirst(field))
      .limit(q.limit)
      .populate({ path: 'orderedBy', select: 'firstName lastName' })
      .lean<Row[]>();
  },
  toItem(o, viewer) {
    const id = o._id.toString();
    const isPatient = viewer.role === ROLES.PATIENT;
    const tests = (o.items ?? [])
      .filter((i) => i.status !== 'cancelled')
      .map((i) => i.testSnapshot?.name)
      .filter(Boolean)
      .join(', ');
    const flags: string[] = [];
    if (!isPatient && o.priority === 'urgent') flags.push('urgent');
    if (!isPatient && o.hasCritical) flags.push('critical');
    return {
      type: 'lab_order',
      id,
      at: (isPatient ? o.releasedAt : o.orderedAt)!,
      title: `${isPatient ? 'Lab report' : 'Lab order'} ${o.orderNumber ?? ''}`.trim(),
      subtitle: joinParts(doctorName(o.orderedBy), tests),
      status: o.status,
      link: links.labOrder(viewer.role, id),
      flags,
    };
  },
});
