import type { Types } from 'mongoose';
import { ROLES } from '../../../config/constants.js';
import { Appointment } from '../../appointments/model.js';
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
  appointmentNumber: string;
  startAt: Date;
  status: string;
  type?: string | null;
  doctor?: PersonRef | null;
  department?: { name?: string } | null;
  serviceSnapshot?: { name?: string } | null;
}

/**
 * Appointments at their start time – every status. Never the booking reason (free text that
 * may be clinical): the doctor, service and department only.
 */
export const appointmentSource = defineSource<Row>({
  type: 'appointment',
  rolesAllowed: [ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.PATIENT],
  async query(patient, q) {
    return Appointment.find({ patient, $and: windowFilter('startAt', 'appointment', q) })
      .select('appointmentNumber startAt status type doctor department serviceSnapshot.name')
      .sort(newestFirst('startAt'))
      .limit(q.limit)
      .populate([
        { path: 'doctor', select: 'firstName lastName' },
        { path: 'department', select: 'name' },
      ])
      .lean<Row[]>();
  },
  toItem(a, viewer) {
    const id = a._id.toString();
    return {
      type: 'appointment',
      id,
      at: a.startAt,
      title: `Visit with ${doctorName(a.doctor)}`,
      subtitle: joinParts(a.serviceSnapshot?.name, a.department?.name, a.appointmentNumber),
      status: a.status,
      link: links.appointment(viewer.role, id),
      flags: a.type === 'follow_up' || a.type === 'walk_in' ? [a.type] : [],
    };
  },
});
