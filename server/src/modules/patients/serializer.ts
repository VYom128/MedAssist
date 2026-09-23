import type { Types } from 'mongoose';
import { ROLES, type DuplicateMatchReason, type Role } from '../../config/constants.js';
import { ageOn, calendarDateString, clinicToday } from '../../utils/dates.js';
import { cachedTimezone } from '../settings/service.js';
import type { PatientDoc } from './model.js';

/**
 * Patient views per role (spec §2.5, with the Phase 3 decision that receptionists see allergies):
 *
 * | Data                           | Admin | Reception | Doctor (rel) | Patient (own) |
 * | Name, MRN, age, sex, contact   |   ✔   |     ✔     |      ✔       |       ✔       |
 * | Allergies                      |   ✘   |     ✔     |      ✔       |       ✔       |
 * | Chronic conditions             |   ✘   |     ✘     |      ✔       |       ✔       |
 * | Insurance                      |   ✔   |     ✔     |      ✘       |       ✔       |
 * | Internal admin notes           |   ✔   |     ✔     |      ✘       |       ✘       |
 *
 * Lab technicians get a minimal view with lab orders (Phase 6).
 */

export type PatientLike = PatientDoc & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

/** The patient's portal account, for staff views (spec §4.3 step 5, §4.4). */
export interface PortalInfo {
  hasAccount: boolean;
  email: string | null;
  linkStatus: 'linked' | 'pending_verification' | null;
  lastLoginAt: Date | null;
}

const dateOnly = (d?: Date | null) => (d ? calendarDateString(d) : null);
const idOf = (id?: Types.ObjectId | null) => id?.toString() ?? null;

/** Age in whole years today (clinic timezone). */
export const ageOf = (p: Pick<PatientLike, 'dateOfBirth'>) =>
  ageOn(p.dateOfBirth, clinicToday(cachedTimezone()));

function core(p: PatientLike) {
  return {
    id: p._id.toString(),
    mrn: p.mrn,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: `${p.firstName} ${p.lastName}`,
    age: ageOf(p),
    gender: p.gender,
    isActive: p.isActive,
  };
}

/** One row of GET /patients. */
export function toListItem(p: PatientLike) {
  return { ...core(p), phone: p.phone, hasPortal: Boolean(p.user) };
}

function demographics(p: PatientLike) {
  return {
    ...toListItem(p),
    dateOfBirth: dateOnly(p.dateOfBirth),
    bloodGroup: p.bloodGroup ?? 'unknown',
    email: p.email ?? null,
    address: p.address ?? null,
    emergencyContact: p.emergencyContact ?? null,
    preferredLanguage: p.preferredLanguage,
    consent: {
      dataProcessing: {
        given: p.consent?.dataProcessing?.given ?? false,
        at: p.consent?.dataProcessing?.at ?? null,
      },
      aiExplanations: {
        given: p.consent?.aiExplanations?.given ?? false,
        at: p.consent?.aiExplanations?.at ?? null,
      },
      communications: {
        email: p.consent?.communications?.email ?? true,
        sms: p.consent?.communications?.sms ?? false,
      },
    },
    registeredAt: p.createdAt ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}

const allergies = (p: PatientLike) =>
  (p.allergies ?? []).map((a) => ({
    id: a._id.toString(),
    substance: a.substance,
    reaction: a.reaction ?? null,
    severity: a.severity,
    recordedBy: idOf(a.recordedBy),
    recordedAt: a.recordedAt ?? null,
  }));

const chronicConditions = (p: PatientLike) =>
  (p.chronicConditions ?? []).map((c) => ({
    id: c._id.toString(),
    name: c.name,
    since: dateOnly(c.since),
    notes: c.notes ?? null,
    recordedBy: idOf(c.recordedBy),
    recordedAt: c.recordedAt ?? null,
  }));

const insurance = (p: PatientLike) =>
  p.insurance
    ? {
        provider: p.insurance.provider ?? null,
        policyNumber: p.insurance.policyNumber ?? null,
        validTill: dateOnly(p.insurance.validTill),
      }
    : null;

/** Admin: demographics, insurance and admin notes; no allergies or chronic conditions. */
export function toAdminView(p: PatientLike, portal?: PortalInfo) {
  return {
    ...demographics(p),
    insurance: insurance(p),
    adminNotes: p.adminNotes ?? null,
    ...(portal ? { portal } : {}),
  };
}

/** Reception: as admin plus allergies (safety information); no chronic conditions. */
export function toReceptionView(p: PatientLike, portal?: PortalInfo) {
  return { ...toAdminView(p, portal), allergies: allergies(p) };
}

/** Doctor with a care relationship (from Phase 5): everything except insurance and admin notes. */
export function toDoctorView(p: PatientLike) {
  return {
    ...demographics(p),
    allergies: allergies(p),
    chronicConditions: chronicConditions(p),
  };
}

/** The patient themselves: everything except admin notes. */
export function toPatientSelfView(p: PatientLike) {
  return { ...toDoctorView(p), insurance: insurance(p) };
}

/** The full-record view for a role (lab technicians get none until Phase 6). */
export function viewForRole(role: Role, p: PatientLike, portal?: PortalInfo) {
  switch (role) {
    case ROLES.ADMIN:
      return toAdminView(p, portal);
    case ROLES.RECEPTIONIST:
      return toReceptionView(p, portal);
    case ROLES.DOCTOR:
      return toDoctorView(p);
    case ROLES.PATIENT:
      return toPatientSelfView(p);
    default:
      throw new Error(`No patient view for role ${role}`);
  }
}

/** A possible duplicate (spec §4.3), for GET /patients/check-duplicate and 409 details. */
export function toDuplicateMatch(p: PatientLike, matchedOn: DuplicateMatchReason[]) {
  return {
    id: p._id.toString(),
    mrn: p.mrn,
    fullName: `${p.firstName} ${p.lastName}`,
    dateOfBirth: dateOnly(p.dateOfBirth),
    phone: p.phone,
    isActive: p.isActive,
    matchedOn,
  };
}
