import { AUDIT_ACTIONS, ROLES } from '../../config/constants.js';
import { assertCanViewAppointment } from '../../policies/appointmentAccess.js';
import * as audit from '../../services/audit.service.js';
import {
  clinicHeader,
  createPdf,
  detailsGrid,
  paragraph,
  rule,
} from '../../services/pdf.service.js';
import type { AuthUser } from '../../types/express.js';
import { formatClinicDateTime } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { loadAppointment, resourceOf } from './service.js';

/**
 * GET /appointments/:id/slip.pdf (spec §12.3, Phase 10): the appointment slip – number, patient,
 * doctor, department, date and time in the clinic timezone, the token once checked in, the
 * clinic's address and phone (header) and "Please arrive 10 minutes early". No clinical details.
 * Made on demand (never stored); reception, admins and the patient (own); audited.
 */

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  checked_in: 'Checked in',
  in_consultation: 'In consultation',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Missed',
};

export async function appointmentSlipPdf(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user); // 403 while the link is pending
  const a = await loadAppointment(id);
  await assertCanViewAppointment(user, a, meta);
  const { timezone } = await getSettings();
  const pdf = createPdf({
    title: `Appointment ${a.appointmentNumber}`,
    subject: 'Appointment slip',
    unicode: true,
    ...(a.status === 'cancelled' ? { watermark: 'CANCELLED' } : {}),
  });
  await clinicHeader(pdf, 'APPOINTMENT SLIP');
  const patient = a.patient as { firstName?: string; lastName?: string; mrn?: string };
  const doctor = a.doctor as { firstName?: string; lastName?: string };
  const department = (a as { department?: { name?: string } | null }).department;
  detailsGrid(pdf, [
    ['Appointment', a.appointmentNumber],
    ['Status', STATUS_LABELS[a.status] ?? a.status],
    ['Patient', `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || null],
    ['MRN', patient.mrn ?? null],
    ['Doctor', `Dr ${doctor.firstName ?? ''} ${doctor.lastName ?? ''}`.trim()],
    ['Department', department?.name ?? null],
    ['Date and time', formatClinicDateTime(a.startAt, timezone)],
    ['Token', a.queue?.tokenNumber ? String(a.queue.tokenNumber) : null],
  ]);
  rule(pdf);
  pdf.doc.moveDown(0.5);
  paragraph(pdf, 'Please arrive 10 minutes early and bring this slip and any previous reports.');
  paragraph(pdf, 'To change or cancel, log in to the patient portal or call the clinic.', {
    muted: true,
  });
  const buffer = await pdf.finish();
  await audit.record({
    action: AUDIT_ACTIONS.APPOINTMENT_SLIP_DOWNLOAD,
    actor: actorOf(user),
    resource: resourceOf(a),
    patient: a.patient._id,
    request: meta,
    metadata: { status: a.status },
  });
  return { buffer, fileName: `appointment-${a.appointmentNumber}.pdf` };
}
