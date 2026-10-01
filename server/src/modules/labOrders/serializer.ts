import type { Types } from 'mongoose';
import { ageOf, toLabTechView, type PatientLike } from '../patients/serializer.js';
import type { LabOrderDoc, LabOrderItem, LabResult } from './model.js';

/**
 * Lab order views per role (spec §2.4, §2.5, §8.7, Phase 6 decisions):
 * - lab technician: everything the lab needs – the patient's name, MRN, age, sex and allergies,
 *   clinical notes, sample, results with all versions and pending revisions;
 * - doctor: results once an item has them (marked unverified until verified), old versions,
 *   whether a revision is pending (not its values);
 * - receptionist: status only, with the tests and their prices (billing) – no results or notes;
 * - patient (own, released): the current released results only – no remarks, old versions or
 *   pending revisions.
 */

interface PersonDoc {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
}
type PersonRef = Types.ObjectId | PersonDoc | null | undefined;

type PatientRef = Pick<
  PatientLike,
  '_id' | 'mrn' | 'firstName' | 'lastName' | 'dateOfBirth' | 'gender' | 'allergies'
>;

export type LabOrderLike = Omit<LabOrderDoc, 'orderedBy' | 'patient'> & {
  _id: Types.ObjectId;
  __v?: number;
  orderedBy: PersonDoc;
  patient: PatientRef;
  createdAt?: Date;
  updatedAt?: Date;
};

/** For lists and single reads: the ordering doctor and the patient. */
export const LAB_ORDER_POPULATE = [
  { path: 'orderedBy', select: 'firstName lastName' },
  { path: 'patient', select: 'mrn firstName lastName dateOfBirth gender allergies' },
] as const;

/** Detail views also name who collected, entered, verified and released. */
export const LAB_ORDER_DETAIL_POPULATE = [
  ...LAB_ORDER_POPULATE,
  { path: 'sample.collectedBy', select: 'firstName lastName' },
  { path: 'items.enteredBy', select: 'firstName lastName' },
  { path: 'items.verifiedBy', select: 'firstName lastName' },
  { path: 'releasedBy', select: 'firstName lastName' },
] as const;

const orNull = <T>(v: T | null | undefined): T | null => v ?? null;

/** `{ id, name }` for a populated user, `{ id, name: null }` for a bare id, null for none. */
function person(ref: PersonRef) {
  if (!ref) return null;
  if ('firstName' in ref)
    return { id: ref._id.toString(), name: `${ref.firstName} ${ref.lastName}` };
  return { id: ref.toString(), name: null };
}

const doctorOf = (o: LabOrderLike) => ({
  id: o.orderedBy._id.toString(),
  name: `${o.orderedBy.firstName} ${o.orderedBy.lastName}`,
});

const patientSummary = (o: LabOrderLike) => ({
  id: o.patient._id.toString(),
  mrn: o.patient.mrn,
  fullName: `${o.patient.firstName} ${o.patient.lastName}`,
});

function core(o: LabOrderLike) {
  return {
    id: o._id.toString(),
    orderNumber: orNull(o.orderNumber),
    status: o.status,
    priority: o.priority,
    orderedAt: orNull(o.orderedAt),
    createdAt: orNull(o.createdAt),
    orderedBy: doctorOf(o),
    encounterId: o.encounter.toString(),
    appointmentId: o.appointment.toString(),
  };
}

const resultView = (r: LabResult) => ({
  parameterKey: r.parameterKey,
  name: r.name,
  unit: orNull(r.unit),
  value: r.value ?? null,
  referenceText: orNull(r.referenceText),
  flag: r.flag,
});

const testOf = (i: LabOrderItem) => ({
  id: i._id.toString(),
  testId: i.test.toString(),
  code: i.testSnapshot.code,
  name: i.testSnapshot.name,
});

const cancellationOf = (c: LabOrderLike['cancellation']) =>
  c?.at ? { by: person(c.by as PersonRef)?.id ?? null, at: c.at, reason: orNull(c.reason) } : null;

/** When a released item's results were last corrected (null if never revised). */
const correctedAt = (i: LabOrderItem) =>
  i.previousResults?.length ? (i.previousResults.at(-1)?.revisedAt ?? null) : null;

const previousVersions = (i: LabOrderItem) =>
  (i.previousResults ?? []).map((p) => ({
    version: p.version,
    results: (p.results ?? []).map(resultView),
    remarks: orNull(p.remarks),
    revisedBy: person(p.revisedBy as PersonRef)?.id ?? null,
    revisedAt: orNull(p.revisedAt),
    reason: orNull(p.reason),
  }));

/** Doctors see an item's results once it has them (spec §8.7: "unverified" until verified). */
/**
 * Doctors see an item's results once it has them (spec §8.7: "unverified" until verified) – and
 * a critical value at once, even while the rest of the test is still being entered (they were
 * alerted about it).
 */
const doctorSeesResults = (i: LabOrderItem) =>
  i.status === 'result_entered' ||
  i.status === 'verified' ||
  (i.status === 'pending' && (i.results ?? []).some((r) => r.flag.startsWith('critical')));

function sampleView(o: LabOrderLike, { full }: { full: boolean }) {
  const s = o.sample;
  if (!s?.sampleId && !s?.rejection?.at) return null;
  return {
    sampleId: orNull(s.sampleId),
    type: orNull(s.type),
    collectedAt: orNull(s.collectedAt),
    collectedBy: person(s.collectedBy as PersonRef),
    ...(full ? { patientAgeYears: orNull(s.patientAgeYears) } : {}),
    rejection: s.rejection?.at ? { reason: orNull(s.rejection.reason), at: s.rejection.at } : null,
  };
}

const history = (o: LabOrderLike) =>
  (o.statusHistory ?? []).map((h) => ({
    status: h.status,
    at: h.at,
    by: h.by ? h.by.toString() : null,
    note: orNull(h.note),
  }));

/**
 * Lab technician: the whole order, plus whether dual verification is on (the verify button
 * explains itself when the viewer entered the results).
 */
export function toLabView(
  o: LabOrderLike,
  { requireDualVerification = true }: { requireDualVerification?: boolean } = {},
) {
  return {
    ...core(o),
    requireDualVerification,
    patient: toLabTechView(o.patient),
    clinicalNotes: orNull(o.clinicalNotes),
    sample: sampleView(o, { full: true }),
    items: o.items.map((i) => ({
      ...testOf(i),
      sampleType: orNull(i.testSnapshot.sampleType),
      turnaroundHours: orNull(i.testSnapshot.turnaroundHours),
      status: i.status,
      results: (i.results ?? []).map(resultView),
      remarks: orNull(i.remarks),
      resultVersion: i.resultVersion ?? 1,
      previousResults: previousVersions(i),
      pendingRevision: i.pendingRevision?.at
        ? {
            results: (i.pendingRevision.results ?? []).map(resultView),
            remarks: orNull(i.pendingRevision.remarks),
            reason: orNull(i.pendingRevision.reason),
            by: person(i.pendingRevision.by as PersonRef)?.id ?? null,
            at: i.pendingRevision.at,
          }
        : null,
      enteredBy: person(i.enteredBy as PersonRef),
      enteredAt: orNull(i.enteredAt),
      verifiedBy: person(i.verifiedBy as PersonRef),
      verifiedAt: orNull(i.verifiedAt),
      cancellation: cancellationOf(i.cancellation),
    })),
    hasCritical: o.hasCritical ?? false,
    tatBreachedAt: orNull(o.tatBreachedAt),
    releasedAt: orNull(o.releasedAt),
    releasedBy: person(o.releasedBy as PersonRef),
    reportAvailable: Boolean(o.reportDocument),
    cancellation: cancellationOf(o.cancellation),
    statusHistory: history(o),
    revision: o.__v ?? 0,
  };
}

/** Doctor (ordering, or with a care relationship). */
export function toDoctorView(o: LabOrderLike) {
  return {
    ...core(o),
    patient: { ...patientSummary(o), age: ageOf(o.patient), gender: o.patient.gender },
    clinicalNotes: orNull(o.clinicalNotes),
    sample: sampleView(o, { full: false }),
    items: o.items.map((i) => {
      const visible = doctorSeesResults(i);
      return {
        ...testOf(i),
        status: i.status,
        resultsAvailable: visible,
        unverified: visible && i.status !== 'verified',
        results: visible ? (i.results ?? []).map(resultView) : [],
        remarks: visible ? orNull(i.remarks) : null,
        resultVersion: i.resultVersion ?? 1,
        correctedAt: correctedAt(i),
        previousResults: visible ? previousVersions(i) : [],
        revisionPending: Boolean(i.pendingRevision?.at),
        cancellation: cancellationOf(i.cancellation),
      };
    }),
    hasCritical: o.hasCritical ?? false,
    releasedAt: orNull(o.releasedAt),
    reviewedByDoctorAt: orNull(o.reviewedByDoctorAt),
    reportAvailable: Boolean(o.reportDocument),
    cancellation: cancellationOf(o.cancellation),
    statusHistory: history(o),
    revision: o.__v ?? 0,
  };
}

/** Receptionist (billing): status and tests with prices – no results, notes or sample. */
export function toReceptionView(o: LabOrderLike) {
  return {
    id: o._id.toString(),
    orderNumber: orNull(o.orderNumber),
    status: o.status,
    priority: o.priority,
    orderedAt: orNull(o.orderedAt),
    releasedAt: orNull(o.releasedAt),
    cancelledAt: orNull(o.cancellation?.at),
    orderedBy: doctorOf(o),
    appointmentId: o.appointment.toString(),
    patient: patientSummary(o),
    tests: o.items.map((i) => ({
      ...testOf(i),
      pricePaise: i.testSnapshot.pricePaise,
      cancelled: i.status === 'cancelled',
    })),
  };
}

/** The patient's own released order: the current released results only. */
export function toPatientView(o: LabOrderLike) {
  return {
    id: o._id.toString(),
    orderNumber: orNull(o.orderNumber),
    orderedAt: orNull(o.orderedAt),
    releasedAt: orNull(o.releasedAt),
    orderedBy: doctorOf(o),
    sampleCollectedAt: orNull(o.sample?.collectedAt),
    reportAvailable: Boolean(o.reportDocument),
    items: o.items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => ({
        ...testOf(i),
        results: (i.results ?? []).map(resultView),
        resultVersion: i.resultVersion ?? 1,
        correctedAt: correctedAt(i),
      })),
  };
}

/**
 * Counts of flagged results a doctor can already see (entered or verified tests, and early
 * criticals), for lists: low, high, abnormal (options) and critical.
 */
function flagSummary(o: LabOrderLike) {
  const counts = { low: 0, high: 0, abnormal: 0, critical: 0 };
  for (const i of o.items.filter(doctorSeesResults)) {
    for (const r of i.results ?? []) {
      if (r.flag === 'critical_low' || r.flag === 'critical_high') counts.critical += 1;
      else if (r.flag === 'low' || r.flag === 'high' || r.flag === 'abnormal') counts[r.flag] += 1;
    }
  }
  return counts;
}

/** One row of GET /lab-orders for the caller's role. */
export function toListItem(o: LabOrderLike, role: string) {
  const tests = o.items.map((i) => ({ code: i.testSnapshot.code, name: i.testSnapshot.name }));
  switch (role) {
    case 'labtech':
      return {
        ...core(o),
        patient: { ...patientSummary(o), age: ageOf(o.patient), gender: o.patient.gender },
        tests: o.items.map((i) => ({ ...testOf(i), status: i.status })),
        sampleId: orNull(o.sample?.sampleId),
        hasCritical: o.hasCritical ?? false,
        tatBreachedAt: orNull(o.tatBreachedAt),
      };
    case 'doctor':
      return {
        ...core(o),
        patient: patientSummary(o),
        tests,
        hasCritical: o.hasCritical ?? false,
        flags: flagSummary(o),
        releasedAt: orNull(o.releasedAt),
        reviewedByDoctorAt: orNull(o.reviewedByDoctorAt),
      };
    case 'receptionist':
      return toReceptionView(o);
    default:
      return {
        id: o._id.toString(),
        orderNumber: orNull(o.orderNumber),
        orderedAt: orNull(o.orderedAt),
        releasedAt: orNull(o.releasedAt),
        orderedBy: doctorOf(o),
        tests: o.items.filter((i) => i.status !== 'cancelled').map((i) => testOf(i)),
        reportAvailable: Boolean(o.reportDocument),
        corrected: o.items.some((i) => (i.resultVersion ?? 1) > 1),
      };
  }
}
