import type { Types } from 'mongoose';
import { ROLES, type Role } from '../../config/constants.js';

/**
 * Search results (spec §12.1): the minimum to recognise a record and open it – number, name,
 * date, status and the caller's own page for it. Never clinical details or amounts.
 */

type Id = Types.ObjectId;
interface PersonRef {
  _id: Id;
  firstName?: string | null;
  lastName?: string | null;
  mrn?: string | null;
}
const name = (p?: PersonRef | null) =>
  p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null;

const PATIENT_PAGES: Partial<Record<Role, string>> = {
  [ROLES.ADMIN]: '/admin/patients',
  [ROLES.RECEPTIONIST]: '/reception/patients',
  [ROLES.DOCTOR]: '/doctor/patients',
};

export function patientResult(p: PersonRef, role: Role) {
  const base = PATIENT_PAGES[role];
  return {
    id: p._id.toString(),
    mrn: p.mrn ?? null,
    name: name(p),
    link: base ? `${base}/${p._id.toString()}` : null,
  };
}

const APPOINTMENT_PAGES: Partial<Record<Role, (id: string) => string>> = {
  [ROLES.ADMIN]: (id) => `/admin/appointments/${id}`,
  [ROLES.RECEPTIONIST]: (id) => `/reception/appointments/${id}`,
  [ROLES.DOCTOR]: (id) => `/doctor/appointments/${id}`,
  [ROLES.PATIENT]: () => '/patient/appointments',
};

export function appointmentResult(
  a: {
    _id: Id;
    appointmentNumber: string;
    startAt: Date;
    status: string;
    patient?: PersonRef | null;
    doctor?: PersonRef | null;
  },
  role: Role,
) {
  const id = a._id.toString();
  return {
    id,
    number: a.appointmentNumber,
    startAt: a.startAt,
    status: a.status,
    patientName: role === ROLES.PATIENT ? null : name(a.patient),
    doctorName: name(a.doctor),
    link: APPOINTMENT_PAGES[role]?.(id) ?? null,
  };
}

export function invoiceResult(
  i: {
    _id: Id;
    invoiceNumber?: string | null;
    status: string;
    issuedAt?: Date | null;
    patient?: PersonRef | null;
  },
  role: Role,
) {
  const id = i._id.toString();
  const base =
    role === ROLES.PATIENT
      ? '/patient/invoices'
      : role === ROLES.ADMIN
        ? '/admin/invoices'
        : '/reception/invoices';
  return {
    id,
    number: i.invoiceNumber ?? null,
    status: i.status,
    issuedAt: i.issuedAt ?? null,
    patientName: role === ROLES.PATIENT ? null : name(i.patient),
    link: `${base}/${id}`,
  };
}

export function labOrderResult(
  o: {
    _id: Id;
    orderNumber?: string | null;
    status: string;
    orderedAt?: Date | null;
    sample?: { sampleId?: string | null } | null;
    patient?: PersonRef | null;
  },
  role: Role,
) {
  const id = o._id.toString();
  const patientId = o.patient?._id.toString() ?? null;
  const link =
    role === ROLES.LABTECH
      ? `/lab/orders/${id}`
      : role === ROLES.DOCTOR
        ? `/doctor/lab-orders/${id}`
        : role === ROLES.PATIENT
          ? `/patient/lab-reports/${id}`
          : patientId
            ? `/reception/patients/${patientId}`
            : null;
  return {
    id,
    number: o.orderNumber ?? null,
    sampleId: o.sample?.sampleId ?? null,
    status: o.status,
    orderedAt: o.orderedAt ?? null,
    patientName: role === ROLES.PATIENT ? null : name(o.patient),
    patientMrn: role === ROLES.PATIENT ? null : (o.patient?.mrn ?? null),
    link,
  };
}
