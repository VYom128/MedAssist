import { Types } from 'mongoose';
import { AUDIT_ACTIONS, FOLLOW_UP_DUE_RULES, ENCOUNTER_RULES } from '../../config/constants.js';
import { assertCanAccessPatient } from '../../policies/patientAccess.js';
import { ISSUED_STATUSES } from '../../policies/prescriptionAccess.js';
import * as audit from '../../services/audit.service.js';
import type { AuthUser } from '../../types/express.js';
import { addDaysToDate, clinicToday, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { Appointment } from '../appointments/model.js';
import { LabOrder } from '../labOrders/model.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { Prescription } from '../prescriptions/model.js';
import { getSettings } from '../settings/service.js';
import {
  followUpDueDate,
  isFollowUpBooked,
  NOT_BOOKED_STATUSES,
  type LaterAppointment,
} from './followUp.js';
import { Encounter } from './model.js';
import {
  ENCOUNTER_POPULATE,
  toPatientVisitItem,
  type EncounterLike,
  type PatientViewExtras,
} from './serializer.js';

/**
 * The patient's own visits (Phase 8): the patient-safe view of a signed note, the list of signed
 * visits and the planned follow-ups not yet booked. Never drafts.
 */

const SIGNED = { $in: ['signed', 'amended'] };
type Department = { id: string; name: string } | null;

/** The departments of the visits' appointments, by appointment id (one query). */
async function departmentsOf(appointmentIds: Types.ObjectId[]): Promise<Map<string, Department>> {
  const rows = await Appointment.find({ _id: { $in: appointmentIds } })
    .select('department')
    .populate({ path: 'department', select: 'name' })
    .lean<{ _id: Types.ObjectId; department?: { _id: Types.ObjectId; name: string } | null }[]>();
  return new Map(
    rows.map((a) => [
      a._id.toString(),
      a.department ? { id: a.department._id.toString(), name: a.department.name } : null,
    ]),
  );
}

/** What the patient-safe view links to: department, issued prescription, released lab orders. */
export async function patientViewExtras(e: EncounterLike): Promise<PatientViewExtras> {
  const [departments, prescription, labOrders] = await Promise.all([
    departmentsOf([e.appointment]),
    Prescription.findOne({ encounter: e._id, status: { $in: ISSUED_STATUSES } })
      .sort({ isCurrent: -1, issuedAt: -1 })
      .select('_id')
      .lean(),
    LabOrder.find({ encounter: e._id, status: 'released' })
      .sort({ releasedAt: 1 })
      .select('orderNumber')
      .lean(),
  ]);
  return {
    department: departments.get(e.appointment.toString()) ?? null,
    prescriptionId: prescription?._id.toString() ?? null,
    labOrders: labOrders.map((o) => ({ id: o._id.toString(), orderNumber: o.orderNumber ?? null })),
  };
}

/**
 * GET /patients/me/visits – the patient's signed visits, newest first, with the primary
 * diagnosis only when the doctor shared it. Audited like a doctor's history read (debounced).
 */
export async function listMyVisits(
  user: AuthUser,
  { page, limit, skip }: Pagination,
  meta: RequestMeta,
) {
  const patientId = await resolveMyPatientId(user);
  await assertCanAccessPatient(user, patientId, 'clinical', meta);
  const filter = { patient: new Types.ObjectId(patientId), status: SIGNED };
  const [rows, total] = await Promise.all([
    Encounter.find(filter)
      .sort({ signedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate([...ENCOUNTER_POPULATE])
      .lean(),
    Encounter.countDocuments(filter),
  ]);
  const visits = rows as unknown as EncounterLike[];
  const departments = await departmentsOf(visits.map((e) => e.appointment));
  if (visits.length > 0) {
    await audit.recordRead({
      action: AUDIT_ACTIONS.ENCOUNTER_VIEW,
      actor: actorOf(user),
      resource: { type: 'encounter_history', id: patientId },
      patient: patientId,
      request: meta,
    });
  }
  return {
    items: visits.map((e) =>
      toPatientVisitItem(e, departments.get(e.appointment.toString()) ?? null),
    ),
    meta: buildMeta({ page, limit, total }),
  };
}

/**
 * GET /patients/me/follow-ups-due – follow-ups planned on the patient's signed notes that are
 * upcoming or overdue by at most 14 days and not booked yet (no later appointment with that
 * doctor, nor one linked to the visit), soonest first, with what the booking page needs.
 */
export async function listFollowUpsDue(user: AuthUser, meta: RequestMeta, now = new Date()) {
  const patientId = await resolveMyPatientId(user);
  await assertCanAccessPatient(user, patientId, 'clinical', meta);
  const patient = new Types.ObjectId(patientId);
  const { timezone } = await getSettings();
  const today = clinicToday(timezone, now);
  const earliestDue = addDaysToDate(today, -FOLLOW_UP_DUE_RULES.overdueDays);
  // A follow-up is due at most maxFollowUpDays after signing (or on a date chosen before it).
  const signedSince = startOfClinicDay(
    addDaysToDate(earliestDue, -ENCOUNTER_RULES.maxFollowUpDays),
    timezone,
  );

  const notes = (await Encounter.find({
    patient,
    status: SIGNED,
    'followUp.required': true,
    signedAt: { $gte: signedSince },
  })
    .select('encounterNumber appointment doctor visitAt signedAt followUp')
    .populate({ path: 'doctor', select: 'firstName lastName' })
    .lean()) as unknown as EncounterLike[];

  const due = notes
    .map((e) => ({ e, dueDate: followUpDueDate(e, timezone) }))
    .filter((x): x is { e: EncounterLike; dueDate: string } =>
      Boolean(x.dueDate && x.dueDate >= earliestDue),
    );
  if (due.length === 0) return [];

  const firstVisit = new Date(Math.min(...due.map(({ e }) => e.visitAt.getTime())));
  const [appointments, departments] = await Promise.all([
    Appointment.find({
      patient,
      status: { $nin: NOT_BOOKED_STATUSES },
      $or: [
        { startAt: { $gt: firstVisit } },
        { followUpOf: { $in: due.map(({ e }) => e.appointment) } },
      ],
    })
      .select('doctor startAt followUpOf')
      .lean<LaterAppointment[]>(),
    departmentsOf(due.map(({ e }) => e.appointment)),
  ]);

  const items = due
    .filter(({ e }) => !isFollowUpBooked(e, appointments))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(({ e, dueDate }) => ({
      encounterId: e._id.toString(),
      encounterNumber: e.encounterNumber,
      visitAt: e.visitAt,
      doctor: { id: e.doctor._id.toString(), name: `${e.doctor.firstName} ${e.doctor.lastName}` },
      department: departments.get(e.appointment.toString()) ?? null,
      dueDate,
      overdue: dueDate < today,
      instructions: e.followUp?.instructions ?? null,
      /** Query parameters for the booking page (spec §4.10: doctor + follow-up of the visit). */
      booking: {
        doctorId: e.doctor._id.toString(),
        followUpOf: e.appointment.toString(),
        type: 'follow_up' as const,
      },
    }));
  if (items.length > 0) {
    await audit.recordRead({
      action: AUDIT_ACTIONS.ENCOUNTER_VIEW,
      actor: actorOf(user),
      resource: { type: 'follow_ups_due', id: patientId },
      patient: patientId,
      request: meta,
    });
  }
  return items;
}
