import { Types, type Model } from 'mongoose';
import { ROLES, SEARCH_RULES, type Role } from '../../config/constants.js';
import { appointmentListFilter } from '../../policies/appointmentAccess.js';
import { invoiceListFilter } from '../../policies/invoiceAccess.js';
import {
  patientListFilter,
  PLACED_LAB_ORDER,
  relatedPatientIds,
} from '../../policies/patientAccess.js';
import type { AuthUser } from '../../types/express.js';
import { logger } from '../../utils/logger.js';
import { escapeRegex } from '../../utils/regex.js';
import { buildPatientSearchQuery } from '../../utils/search.js';
import { Appointment } from '../appointments/model.js';
import { Invoice } from '../invoices/model.js';
import { LabOrder } from '../labOrders/model.js';
import { Patient } from '../patients/model.js';
import { appointmentResult, invoiceResult, labOrderResult, patientResult } from './serializer.js';

/**
 * Global search (spec §12.1, Phase 10): patients (name, MRN, phone), appointments, invoices and
 * lab orders (number / sample id) – only the groups the caller's role may see, each scoped by the
 * same policies as the lists (patients: their own records; doctors: patients they have a care
 * relationship with, their own appointments and orders; lab techs: placed orders with minimal
 * patient data). At most 5 per group: exact matches first, then anchored, case-insensitive
 * prefixes (indexed; never a leading wildcard). Patients use the patient search rules (D70) –
 * exact MRN/phone, else name prefixes; there is no text index yet.
 *
 * The search itself is not audited; only the query length is logged, never the text.
 */

type Group = 'patients' | 'appointments' | 'invoices' | 'labOrders';
type Filter = Record<string, unknown>;

const GROUPS: Record<Role, Group[]> = {
  [ROLES.ADMIN]: ['patients', 'appointments', 'invoices'],
  [ROLES.RECEPTIONIST]: ['patients', 'appointments', 'invoices', 'labOrders'],
  [ROLES.DOCTOR]: ['patients', 'appointments', 'labOrders'],
  [ROLES.LABTECH]: ['labOrders'],
  [ROLES.PATIENT]: ['appointments', 'invoices', 'labOrders'],
};

const LIMIT = SEARCH_RULES.perGroup;
const NOTHING: Filter = { _id: { $in: [] } };
const PERSON = 'firstName lastName mrn';

/** The term as a record number ('apt-2026-12' → 'APT-2026-12'), or null if it can't be one. */
function numberTerm(q: string): string | null {
  const t = q.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9-]{2,}$/.test(t) && /\d/.test(t) ? t : null;
}

/**
 * Exact matches of `field` first, then anchored prefixes, within `base`; at most LIMIT.
 * Fields are indexed (unique number indexes), so `^PREFIX` stays an index range scan.
 */
async function byNumber<T extends { _id: Types.ObjectId }>(
  model: Model<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  fields: string[],
  term: string,
  base: Filter,
  populate: { path: string; select: string }[],
  sort: Record<string, 1 | -1>,
): Promise<T[]> {
  const find = (filter: Filter, limit: number) =>
    model
      .find({ $and: [base, filter] })
      .populate(populate)
      .sort(sort)
      .limit(limit)
      .lean<T[]>();
  const exact = await find({ $or: fields.map((f) => ({ [f]: term })) }, LIMIT);
  if (exact.length >= LIMIT) return exact;
  const prefix = new RegExp(`^${escapeRegex(term)}`);
  const more = await find(
    {
      $or: fields.map((f) => ({ [f]: prefix })),
      _id: { $nin: exact.map((d) => d._id) },
    },
    LIMIT - exact.length,
  );
  return [...exact, ...more];
}

async function searchPatients(user: AuthUser, q: string) {
  const match = buildPatientSearchQuery(q);
  if (!match) return [];
  const docs = await Patient.find({ $and: [await patientListFilter(user), match] })
    .select('firstName lastName mrn')
    .sort({ lastName: 1, firstName: 1, _id: 1 })
    .limit(LIMIT)
    .lean();
  return docs.map((p) => patientResult(p, user.role));
}

async function searchAppointments(user: AuthUser, term: string | null) {
  if (!term) return [];
  const docs = await byNumber<Parameters<typeof appointmentResult>[0]>(
    Appointment,
    ['appointmentNumber'],
    term,
    appointmentListFilter(user),
    [
      { path: 'patient', select: PERSON },
      { path: 'doctor', select: 'firstName lastName' },
    ],
    { startAt: -1, _id: -1 },
  );
  return docs.map((a) => appointmentResult(a, user.role));
}

async function searchInvoices(user: AuthUser, term: string | null) {
  if (!term) return [];
  const docs = await byNumber<Parameters<typeof invoiceResult>[0]>(
    Invoice,
    ['invoiceNumber'],
    term,
    invoiceListFilter(user, user.patientId),
    [{ path: 'patient', select: PERSON }],
    { issuedAt: -1, _id: -1 },
  );
  return docs.map((i) => invoiceResult(i, user.role));
}

/** The lab orders a role may find (mirrors GET /lab-orders and policies/labOrderAccess). */
async function labOrderBase(user: AuthUser): Promise<Filter> {
  switch (user.role) {
    case ROLES.LABTECH:
    case ROLES.RECEPTIONIST:
      return PLACED_LAB_ORDER;
    case ROLES.DOCTOR: {
      const me = new Types.ObjectId(user.id);
      const related = await relatedPatientIds(user.id);
      return {
        $or: [
          { orderedBy: me, status: { $ne: 'cancelled' } },
          { ...PLACED_LAB_ORDER, patient: { $in: related } },
        ],
      };
    }
    case ROLES.PATIENT:
      return user.patientId
        ? { patient: new Types.ObjectId(user.patientId), status: 'released' }
        : NOTHING;
    default:
      return NOTHING;
  }
}

async function searchLabOrders(user: AuthUser, q: string, term: string | null) {
  const base = await labOrderBase(user);
  const populate = [{ path: 'patient', select: PERSON }];
  const sort = { orderedAt: -1 as const, _id: -1 as const };
  const found = term
    ? await byNumber<Parameters<typeof labOrderResult>[0]>(
        LabOrder,
        ['orderNumber', 'sample.sampleId'],
        term,
        base,
        populate,
        sort,
      )
    : [];
  // Lab techs and reception also find orders by the patient's MRN, phone or name.
  if (found.length < LIMIT && (user.role === ROLES.LABTECH || user.role === ROLES.RECEPTIONIST)) {
    const match = buildPatientSearchQuery(q);
    if (match) {
      const patients = await Patient.find(match).select('_id').limit(200).lean();
      const more = await LabOrder.find({
        $and: [
          base,
          { patient: { $in: patients.map((p) => p._id) } },
          { _id: { $nin: found.map((o) => o._id) } },
        ],
      })
        .populate(populate)
        .sort(sort)
        .limit(LIMIT - found.length)
        .lean<Parameters<typeof labOrderResult>[0][]>();
      found.push(...more);
    }
  }
  return found.map((o) => labOrderResult(o, user.role));
}

/** GET /search?q= – grouped results for the caller's role. */
export async function search(user: AuthUser, q: string) {
  logger.debug({ search: { length: q.length, role: user.role } }, 'Global search');
  const groups = GROUPS[user.role] ?? [];
  const term = numberTerm(q);
  const run = async (g: Group) => {
    if (!groups.includes(g)) return undefined;
    switch (g) {
      case 'patients':
        return searchPatients(user, q);
      case 'appointments':
        return searchAppointments(user, term);
      case 'invoices':
        return searchInvoices(user, term);
      case 'labOrders':
        return searchLabOrders(user, q, term);
    }
  };
  const [patients, appointments, invoices, labOrders] = await Promise.all([
    run('patients'),
    run('appointments'),
    run('invoices'),
    run('labOrders'),
  ]);
  return {
    groups,
    ...(patients ? { patients } : {}),
    ...(appointments ? { appointments } : {}),
    ...(invoices ? { invoices } : {}),
    ...(labOrders ? { labOrders } : {}),
  };
}
