import { Types } from 'mongoose';
import type { Role } from '../../src/config/constants.js';
import { appointmentListFilter, canViewAppointment } from '../../src/policies/appointmentAccess.js';
import {
  canHandleFollowup,
  canReadFollowup,
  followupListFilter,
} from '../../src/policies/followupAccess.js';
import { canReadInvoice, invoiceListFilter } from '../../src/policies/invoiceAccess.js';
import { canReadLabOrder } from '../../src/policies/labOrderAccess.js';
import { canReadPrescription } from '../../src/policies/prescriptionAccess.js';

/**
 * Per-role truth tables of the record policies (spec §2.4, §10.2), without the HTTP layer: who
 * may see an appointment, an invoice, a follow-up request, a lab order or a prescription, and
 * what each role's list filter matches. Cases that need the care relationship (a database lookup)
 * are covered by careRelationship.test.ts and the RBAC matrix. The routes are covered by the RBAC matrix; these pin the rules themselves, including
 * the edge cases (lab technicians, patients whose link is still pending, other doctors).
 */

const id = () => new Types.ObjectId();
const NOTHING = { _id: { $in: [] } };

const doctor = id();
const otherDoctor = id();
const patient = id();
const otherPatient = id();

const user = (
  role: Role,
  extra: { id?: Types.ObjectId; patientId?: Types.ObjectId | null } = {},
) => ({
  id: (extra.id ?? id()).toString(),
  role,
  patientId: extra.patientId === undefined ? null : (extra.patientId?.toString() ?? null),
});

const admin = user('admin');
const reception = user('receptionist');
const labtech = user('labtech');
const ownDoctor = user('doctor', { id: doctor });
const strangerDoctor = user('doctor', { id: otherDoctor });
const ownPatient = user('patient', { patientId: patient });
const strangerPatient = user('patient', { patientId: otherPatient });
const pendingPatient = user('patient', { patientId: null });

describe('appointments', () => {
  // Populated and plain refs are both accepted.
  const appt = { _id: id(), patient: { _id: patient }, doctor };

  it.each([
    ['admin', admin, true],
    ['receptionist', reception, true],
    ['their doctor', ownDoctor, true],
    ['another doctor', strangerDoctor, false],
    ['their patient', ownPatient, true],
    ['another patient', strangerPatient, false],
    ['a patient whose link is pending', pendingPatient, false],
    ['a lab technician', labtech, false],
  ])('%s → %s', (_label, u, expected) => {
    expect(canViewAppointment(u, appt)).toBe(expected);
  });

  it('list filters: all, own doctor, own patient, nothing', () => {
    expect(appointmentListFilter(admin)).toEqual({});
    expect(appointmentListFilter(reception)).toEqual({});
    expect(appointmentListFilter(ownDoctor)).toEqual({ doctor: doctor.toString() });
    expect(appointmentListFilter(ownPatient)).toEqual({ patient: patient.toString() });
    expect(appointmentListFilter(pendingPatient)).toEqual(NOTHING);
    expect(appointmentListFilter(labtech)).toEqual(NOTHING);
  });
});

describe('invoices', () => {
  const issued = { _id: id(), patient, status: 'issued' };
  const draft = { _id: id(), patient: { _id: patient }, status: 'draft' };

  it.each([
    ['their patient, issued', ownPatient, issued, true],
    ['their patient, draft', ownPatient, draft, false],
    ['another patient', strangerPatient, issued, false],
    ['a patient whose link is pending', pendingPatient, issued, false],
    ['a doctor (no billing access, D142)', ownDoctor, issued, false],
    ['a lab technician', labtech, issued, false],
  ])('%s → %s', async (_label, u, inv, expected) => {
    expect(await canReadInvoice(u, inv)).toBe(expected);
  });

  it('list filters: all for billing staff, own non-drafts for a patient, nothing otherwise', () => {
    expect(invoiceListFilter(admin)).toEqual({});
    expect(invoiceListFilter(reception)).toEqual({});
    expect(invoiceListFilter(ownPatient, patient.toString())).toEqual({
      patient,
      status: { $ne: 'draft' },
    });
    expect(invoiceListFilter(pendingPatient, null)).toEqual(NOTHING);
    expect(invoiceListFilter(ownDoctor)).toEqual(NOTHING);
    expect(invoiceListFilter(labtech)).toEqual(NOTHING);
  });
});

describe('follow-up requests', () => {
  const assigned = { _id: id(), patient: { _id: patient }, assignedDoctor: { _id: doctor } };
  const unassigned = { _id: id(), patient, assignedDoctor: null };

  it.each([
    ['admin', admin, assigned, true],
    ['receptionist', reception, unassigned, true],
    ['the assigned doctor', ownDoctor, assigned, true],
    ['another doctor', strangerDoctor, assigned, false],
    ['any doctor, unassigned', ownDoctor, unassigned, false],
    ['their patient', ownPatient, assigned, true],
    ['another patient', strangerPatient, assigned, false],
    ['a patient whose link is pending', pendingPatient, assigned, false],
    ['a lab technician', labtech, assigned, false],
  ])('read: %s → %s', (_label, u, r, expected) => {
    expect(canReadFollowup(u, r)).toBe(expected);
  });

  it.each([
    ['receptionist', reception, unassigned, true],
    ['the assigned doctor', ownDoctor, assigned, true],
    ['another doctor', strangerDoctor, assigned, false],
    ['admin (read only)', admin, assigned, false],
    ['their patient (own actions go through read + route)', ownPatient, assigned, false],
    ['a lab technician', labtech, assigned, false],
  ])('handle: %s → %s', (_label, u, r, expected) => {
    expect(canHandleFollowup(u, r)).toBe(expected);
  });

  it('list filters: all, assigned, own, nothing', () => {
    expect(followupListFilter(admin)).toEqual({});
    expect(followupListFilter(reception)).toEqual({});
    expect(followupListFilter(ownDoctor)).toEqual({ assignedDoctor: doctor });
    expect(followupListFilter(ownPatient)).toEqual({ patient });
    expect(followupListFilter(pendingPatient)).toEqual(NOTHING);
    expect(followupListFilter(labtech)).toEqual(NOTHING);
  });
});

describe('lab orders', () => {
  const order = (status: string, placed: boolean) => ({
    _id: id(),
    patient,
    orderedBy: doctor,
    status,
    orderedAt: placed ? new Date() : null,
  });

  it.each([
    ['the ordering doctor, draft', ownDoctor, order('draft', false), true],
    ['another doctor, draft (private to its doctor)', strangerDoctor, order('draft', false), false],
    ['a lab technician, placed', labtech, order('ordered', true), true],
    ['a lab technician, draft', labtech, order('draft', false), false],
    ['a receptionist, placed (status view)', reception, order('ordered', true), true],
    ['their patient, released', ownPatient, order('released', true), true],
    ['their patient, not yet released', ownPatient, order('verified', true), false],
    ['another patient, released', strangerPatient, order('released', true), false],
    ['a patient whose link is pending', pendingPatient, order('released', true), false],
    ['an admin (counts only, never the order)', admin, order('released', true), false],
  ])('%s → %s', async (_label, u, o, expected) => {
    expect(await canReadLabOrder(u, o)).toBe(expected);
  });
});

describe('prescriptions', () => {
  const rx = (status: string) => ({ _id: id(), doctor: { _id: doctor }, patient, status });

  it.each([
    ['its doctor, draft', ownDoctor, rx('draft'), true],
    ['another doctor, draft', strangerDoctor, rx('draft'), false],
    ['their patient, issued', ownPatient, rx('issued'), true],
    ['their patient, completed', ownPatient, rx('completed'), true],
    ['their patient, draft', ownPatient, rx('draft'), false],
    ['their patient, cancelled', ownPatient, rx('cancelled'), false],
    ['another patient, issued', strangerPatient, rx('issued'), false],
    ['a receptionist, issued (printing)', reception, rx('issued'), true],
    ['a receptionist, draft', reception, rx('draft'), false],
    ['an admin', admin, rx('issued'), false],
    ['a lab technician', labtech, rx('issued'), false],
  ])('%s → %s', async (_label, u, p, expected) => {
    expect(await canReadPrescription(u, p)).toBe(expected);
  });
});
