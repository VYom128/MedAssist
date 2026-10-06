import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  NOTIFICATION_TYPES,
  ROLES,
  SEQUENCES,
} from '../../config/constants.js';
import { assertCanReadInvoice, invoiceListFilter } from '../../policies/invoiceAccess.js';
import { assertCanAccessPatient } from '../../policies/patientAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { notify } from '../../services/notification.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { calendarDate, clinicToday, endOfClinicDay, startOfClinicDay } from '../../utils/dates.js';
import { buildMeta, type Pagination } from '../../utils/pagination.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { buildPatientSearchQuery } from '../../utils/search.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { Appointment } from '../appointments/model.js';
import { patientRecipient } from '../appointments/service.js';
import { Patient } from '../patients/model.js';
import { Payment } from '../payments/model.js';
import type { PaymentLike } from '../payments/serializer.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { Service } from '../services/model.js';
import { getSettings } from '../settings/service.js';
import { exceedsDiscountLimit, discountPercent } from './calc.js';
import { defaultTaxRateBps, priceLine, totalsOf, type PricedLine } from './lines.js';
import { Invoice, type InvoiceDoc } from './model.js';
import { buildInvoicePdf } from './pdf.js';
import {
  INVOICE_LIST_POPULATE,
  INVOICE_POPULATE,
  resourceOf,
  toListItem,
  toView,
  type InvoiceLike,
} from './serializer.js';
import type {
  CreateInvoiceInput,
  LineInputBody,
  ListInvoicesQuery,
  UpdateInvoiceInput,
} from './validation.js';

// ---- Loading ---------------------------------------------------------------------------------

/** An invoice with patient, appointment and staff names populated. 404 if none. */
export async function loadInvoice(
  id: string | Types.ObjectId,
  { session }: { session?: ClientSession } = {},
): Promise<InvoiceLike> {
  const inv = await Invoice.findById(id)
    .populate([...INVOICE_POPULATE])
    .session(session ?? null)
    .lean();
  if (!inv) throw ApiError.notFound('Invoice not found');
  return inv as unknown as InvoiceLike;
}

const patientIdOf = (i: InvoiceLike) => i.patient._id;

// ---- Lines from the desk ---------------------------------------------------------------------

const fieldError = (field: string, message: string) =>
  ApiError.validation(message, [{ field, message }]);

/** Maps a consultation/procedure line kind to the service type it must come from. */
const SERVICE_TYPE_FOR = { consultation: 'consultation', procedure: 'procedure' } as const;

/**
 * A new line added at the desk. Consultation and procedure lines snapshot the service's name,
 * price and tax rate (anything else sent for them is ignored); 'other' lines take the
 * description and price given, with the clinic's tax rate unless one is given.
 */
async function newStaffLine(
  input: LineInputBody,
  index: number,
  defaultTax: number,
): Promise<PricedLine> {
  const at = `body.items.${index}`;
  if (!input.kind) throw fieldError(`${at}.kind`, 'Choose what this line is for');
  const quantity = input.quantity ?? 1;
  const discountPaise = input.discountPaise ?? 0;
  if (input.kind === 'other') {
    if (!input.description) throw fieldError(`${at}.description`, 'Describe this line');
    if (input.unitPricePaise === undefined) {
      throw fieldError(`${at}.unitPricePaise`, 'Enter a price');
    }
    return priceLine(
      {
        kind: 'other',
        origin: 'staff',
        description: input.description,
        quantity,
        unitPricePaise: input.unitPricePaise,
        discountPaise,
        taxRateBps: input.taxRateBps ?? defaultTax,
      },
      index,
    );
  }
  if (!input.serviceId) throw fieldError(`${at}.serviceId`, 'Choose a service');
  const service = await Service.findOne({
    _id: input.serviceId,
    isActive: true,
    type: SERVICE_TYPE_FOR[input.kind],
  }).lean();
  if (!service) {
    throw fieldError(`${at}.serviceId`, `Not an active ${input.kind} service`);
  }
  return priceLine(
    {
      kind: input.kind,
      origin: 'staff',
      refId: service._id,
      description: service.name,
      quantity,
      unitPricePaise: service.pricePaise,
      discountPaise,
      taxRateBps: typeof service.taxRateBps === 'number' ? service.taxRateBps : defaultTax,
    },
    index,
  );
}

/** Fields of a visit line the desk may not change (only the discount). */
const VISIT_LOCKED_FIELDS = ['quantity', 'unitPricePaise', 'description', 'taxRateBps'] as const;

/**
 * The invoice's new lines from the full list sent (PATCH): lines with an `id` are kept (and
 * changed), lines left out are removed, lines without an `id` are added. Visit lines (from the
 * appointment or a lab order) keep their price and quantity and cannot be removed – only their
 * discount changes (cancel a lab test to drop its line).
 */
async function mergeLines(
  existing: readonly PricedLine[],
  inputs: readonly LineInputBody[],
  defaultTax: number,
): Promise<PricedLine[]> {
  const byId = new Map(existing.map((l) => [l._id.toString(), l]));
  const seen = new Set<string>();
  const result: PricedLine[] = [];
  for (const [index, input] of inputs.entries()) {
    const at = `body.items.${index}`;
    if (!input.id) {
      result.push(await newStaffLine(input, index, defaultTax));
      continue;
    }
    const line = byId.get(input.id);
    if (!line) throw fieldError(`${at}.id`, 'Not a line of this invoice');
    if (seen.has(input.id)) throw fieldError(`${at}.id`, 'This line is listed twice');
    seen.add(input.id);
    if ((input.kind && input.kind !== line.kind) || input.serviceId) {
      throw fieldError(`${at}.kind`, 'A line cannot change what it is for – add a new line');
    }
    if (line.origin === 'visit') {
      const changed = VISIT_LOCKED_FIELDS.find(
        (f) => input[f] !== undefined && input[f] !== line[f],
      );
      if (changed) {
        throw new ApiError(
          422,
          'Lines from the visit keep their price and quantity; only the discount can change',
          ERROR_CODES.BUSINESS_RULE_VIOLATION,
          [{ field: `${at}.${changed}`, message: 'Only the discount of this line can change' }],
        );
      }
    }
    result.push(
      priceLine(
        {
          ...line,
          ...(line.origin === 'staff'
            ? {
                description: input.description ?? line.description,
                quantity: input.quantity ?? line.quantity,
                unitPricePaise: input.unitPricePaise ?? line.unitPricePaise,
                taxRateBps: input.taxRateBps ?? line.taxRateBps,
              }
            : {}),
          discountPaise: input.discountPaise ?? line.discountPaise,
        },
        index,
      ),
    );
  }
  const removedVisitLine = existing.find(
    (l) => l.origin === 'visit' && !seen.has(l._id.toString()),
  );
  if (removedVisitLine) {
    throw new ApiError(
      422,
      'Lines from the visit cannot be removed. Cancel the lab test instead, or give a discount.',
      ERROR_CODES.BUSINESS_RULE_VIOLATION,
      [{ field: 'body.items', message: 'A line from the visit is missing' }],
    );
  }
  return result;
}

// ---- Discount rule (§4.9) --------------------------------------------------------------------

/**
 * A discount above `maxDiscountPercentWithoutAdmin` of the gross amount needs an admin (422
 * DISCOUNT_REQUIRES_ADMIN). Once an admin has saved such a discount (`discountApproval`), others
 * may still save the invoice as long as no line's discount goes up and no discounted line is
 * added. @returns whether the saved invoice is above the limit (an admin's save records approval).
 */
async function checkDiscount(
  user: AuthUser,
  lines: readonly PricedLine[],
  previous: { lines: readonly PricedLine[]; approved: boolean } | null,
): Promise<boolean> {
  const settings = await getSettings();
  const maxPercent = settings.billing?.maxDiscountPercentWithoutAdmin ?? 10;
  if (!exceedsDiscountLimit(lines, maxPercent)) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (previous?.approved) {
    const before = new Map(previous.lines.map((l) => [l._id.toString(), l.discountPaise]));
    const raised = lines.some((l) => {
      const was = before.get(l._id.toString());
      return was === undefined ? l.discountPaise > 0 : l.discountPaise > was;
    });
    if (!raised) return true;
  }
  throw new ApiError(
    422,
    `Discounts above ${maxPercent}% of the bill need an administrator`,
    ERROR_CODES.DISCOUNT_REQUIRES_ADMIN,
    { maxPercent, discountPercent: Math.round(discountPercent(lines) * 100) / 100 },
  );
}

/** Below the limit the approval is cleared; an admin's save above it records one. */
const approvalUpdate = (user: AuthUser, aboveLimit: boolean) => {
  if (!aboveLimit) return { $unset: { discountApproval: '' as const } };
  if (user.role === ROLES.ADMIN) {
    return { $set: { discountApproval: { by: user.id, at: new Date() } } };
  }
  return {};
};

const summaryOf = (i: {
  items: unknown[];
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  totalPaise: number;
}) => ({
  lineCount: i.items.length,
  subtotalPaise: i.subtotalPaise,
  discountTotalPaise: i.discountTotalPaise,
  taxTotalPaise: i.taxTotalPaise,
  totalPaise: i.totalPaise,
});

// ---- Reads -----------------------------------------------------------------------------------

/** `q`: an invoice number ('INV-2026-12' finds INV-2026-000012), else the patient search. */
async function searchFilter(q: string): Promise<FilterQuery<InvoiceDoc>> {
  const number = /^([A-Z0-9]{1,10})-(\d{4})-(\d{1,9})$/.exec(q.trim().toUpperCase());
  if (number) {
    return {
      invoiceNumber: formatNumber(number[1]!, Number(number[3]), { year: Number(number[2]) }),
    };
  }
  const patientQuery = buildPatientSearchQuery(q);
  if (!patientQuery) return {};
  const patients = await Patient.find(patientQuery).select('_id').limit(200).lean();
  return { patient: { $in: patients.map((p) => p._id) } };
}

/**
 * GET /invoices – reception and admins: all invoices; patients: their own issued ones. Filters:
 * status (several), patient, appointment, issue dates (`from`/`to`, clinic dates; drafts by
 * creation) and `q`. `meta.totals` sums the whole filtered set: billed (issued, not void),
 * collected (net paid) and outstanding (balance of open invoices).
 */
export async function listInvoices(
  user: AuthUser,
  query: ListInvoicesQuery,
  { page, limit, skip }: Pagination,
) {
  const staff = user.role !== ROLES.PATIENT;
  const own = staff ? null : await resolveMyPatientId(user);
  const and: FilterQuery<InvoiceDoc>[] = [invoiceListFilter(user, own)];
  if (query.patient && staff) and.push({ patient: new Types.ObjectId(query.patient) });
  if (query.appointment) and.push({ appointment: new Types.ObjectId(query.appointment) });
  if (query.status) and.push({ status: { $in: query.status } });
  if (query.q && staff) and.push(await searchFilter(query.q));
  if (query.from || query.to) {
    const { timezone } = await getSettings();
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = startOfClinicDay(query.from, timezone);
    if (query.to) range.$lte = endOfClinicDay(query.to, timezone);
    and.push({
      $or: [{ issuedAt: range }, { issuedAt: { $exists: false }, createdAt: range }],
    });
  }
  const filter: FilterQuery<InvoiceDoc> = { $and: and };
  const [items, total, sums] = await Promise.all([
    Invoice.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate([...INVOICE_LIST_POPULATE])
      .lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate<{ billed: number; collected: number; outstanding: number }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          billed: {
            $sum: {
              $cond: [{ $in: ['$status', ['issued', 'partially_paid', 'paid']] }, '$totalPaise', 0],
            },
          },
          collected: {
            $sum: { $cond: [{ $ne: ['$status', 'void'] }, '$amountPaidPaise', 0] },
          },
          outstanding: {
            $sum: {
              $cond: [{ $in: ['$status', ['issued', 'partially_paid']] }, '$balancePaise', 0],
            },
          },
        },
      },
    ]),
  ]);
  const t = sums[0];
  return {
    items: (items as unknown as InvoiceLike[]).map(toListItem),
    meta: {
      ...buildMeta({ page, limit, total }),
      totals: {
        billedPaise: t?.billed ?? 0,
        collectedPaise: t?.collected ?? 0,
        outstandingPaise: t?.outstanding ?? 0,
      },
    },
  };
}

/** GET /invoices/:id – scoped (others → 404); audited `invoice.view` (debounced). */
export async function getInvoice(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user); // 403 while pending
  const inv = await loadInvoice(id);
  await assertCanReadInvoice(user, inv, meta);
  await audit.recordRead({
    action: AUDIT_ACTIONS.INVOICE_VIEW,
    actor: actorOf(user),
    resource: resourceOf(inv),
    patient: patientIdOf(inv),
    request: meta,
  });
  return toView(inv, user.role);
}

/** Loads an invoice a staff caller may change (404 otherwise). */
async function loadForStaff(user: AuthUser, id: string, meta: RequestMeta) {
  const inv = await loadInvoice(id);
  await assertCanReadInvoice(user, inv, meta);
  return inv;
}

// ---- Writes ----------------------------------------------------------------------------------

/** Seed only: back-date the action (`now`) and skip the patient email (`quiet`). */
export interface SeedTimeOptions {
  now?: Date;
  quiet?: boolean;
}

const draftOnly = (status: string) =>
  status === 'draft'
    ? null
    : new ApiError(
        409,
        'Only a draft invoice can be changed. Issued invoices are locked.',
        ERROR_CODES.RECORD_LOCKED,
      );

/** Why a conditional update on a draft missed: locked, or changed meanwhile (409). */
async function staleOrLocked(id: Types.ObjectId) {
  const fresh = await Invoice.findById(id).select('status __v').lean();
  const locked = fresh ? draftOnly(fresh.status) : null;
  if (locked) return locked;
  return ApiError.conflict('This invoice was changed by someone else. Reload it and try again.', {
    currentRevision: fresh?.__v ?? null,
  });
}

/**
 * POST /invoices – a manual draft for a patient (optionally for one of their appointments),
 * with lines added at the desk. One draft per appointment: if the visit already has one → 409.
 */
export async function createInvoice(user: AuthUser, input: CreateInvoiceInput, meta: RequestMeta) {
  await assertCanAccessPatient(user, input.patientId, 'billing', meta);
  const patient = await Patient.findById(input.patientId).select('_id isActive').lean();
  if (!patient) throw ApiError.notFound('Patient not found');
  if (input.appointmentId) {
    const appt = await Appointment.findById(input.appointmentId).select('patient').lean();
    if (!appt) throw fieldError('body.appointmentId', 'Appointment not found');
    if (appt.patient.toString() !== input.patientId) {
      throw fieldError('body.appointmentId', 'This appointment is not for this patient');
    }
  }
  const tax = await defaultTaxRateBps();
  const items: PricedLine[] = [];
  for (const [index, line] of input.items.entries()) {
    items.push(await newStaffLine(line, index, tax));
  }
  const aboveLimit = await checkDiscount(user, items, null);
  const settings = await getSettings();
  const now = new Date();

  let created;
  try {
    created = await Invoice.create({
      kind: 'manual',
      patient: input.patientId,
      ...(input.appointmentId ? { appointment: input.appointmentId } : {}),
      status: 'draft',
      items,
      ...totalsOf(items),
      currency: settings.currency ?? 'INR',
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.dueDate ? { dueDate: calendarDate(input.dueDate) } : {}),
      ...(aboveLimit ? { discountApproval: { by: user.id, at: now } } : {}),
      statusHistory: [{ status: 'draft', at: now, by: user.id }],
      createdBy: user.id,
      updatedBy: user.id,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict(
        'This appointment already has a draft invoice. Add the lines to that one.',
      );
    }
    throw err;
  }

  await audit.record({
    action: AUDIT_ACTIONS.INVOICE_CREATE,
    actor: actorOf(user),
    resource: resourceOf(created),
    patient: created.patient,
    request: meta,
    changes: { fields: ['items'], after: summaryOf(created) },
    metadata: { via: 'manual', discountApproved: aboveLimit },
  });
  return toView(await loadInvoice(created._id), user.role);
}

/**
 * PATCH /invoices/:id – drafts only, with the revision shown (`expectedVersion`; stale → 409
 * CONFLICT). `items` is the full list of lines (see mergeLines); totals are recomputed here and
 * the discount rule applies.
 */
export async function updateInvoice(
  user: AuthUser,
  id: string,
  input: UpdateInvoiceInput,
  meta: RequestMeta,
) {
  const inv = await loadForStaff(user, id, meta);
  const locked = draftOnly(inv.status);
  if (locked) throw locked;
  if ((inv.__v ?? 0) !== input.expectedVersion) {
    throw ApiError.conflict('This invoice was changed by someone else. Reload it and try again.', {
      currentRevision: inv.__v ?? 0,
    });
  }

  const set: Record<string, unknown> = { updatedBy: user.id };
  const unset: Record<string, ''> = {};
  let items = inv.items;
  if (input.items) {
    items = await mergeLines(inv.items, input.items, await defaultTaxRateBps());
    Object.assign(set, { items }, totalsOf(items));
  }
  const wasApproved = Boolean(inv.discountApproval?.at);
  const aboveLimit = await checkDiscount(user, items, { lines: inv.items, approved: wasApproved });
  const approval = approvalUpdate(user, aboveLimit);
  if ('$set' in approval) Object.assign(set, approval.$set);
  if ('$unset' in approval) Object.assign(unset, approval.$unset);
  if (input.notes !== undefined) {
    if (input.notes === null) unset.notes = '';
    else set.notes = input.notes;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate === null) unset.dueDate = '';
    else set.dueDate = calendarDate(input.dueDate);
  }

  const updated = await Invoice.findOneAndUpdate(
    { _id: inv._id, status: 'draft', __v: input.expectedVersion },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $inc: { __v: 1 } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw await staleOrLocked(inv._id);

  const fields = Object.keys(input).filter((k) => k !== 'expectedVersion');
  await audit.record({
    action: AUDIT_ACTIONS.INVOICE_UPDATE,
    actor: actorOf(user),
    resource: resourceOf(inv),
    patient: patientIdOf(inv),
    request: meta,
    changes: { fields, before: summaryOf(inv), after: summaryOf(updated) },
    metadata: { discountApproved: aboveLimit && user.role === ROLES.ADMIN },
  });
  return toView(await loadInvoice(inv._id), user.role);
}

/** The invoice number for an issue now: '<prefix>-<clinic year>-000001' (spec §8.10). */
async function nextInvoiceNumber(session: ClientSession, now: Date) {
  const settings = await getSettings();
  const year = Number(clinicToday(settings.timezone, now).slice(0, 4));
  const seq = await nextSequence(`${SEQUENCES.INVOICE.key}:${year}`, { session });
  const prefix = settings.billing?.invoicePrefix?.trim() || SEQUENCES.INVOICE.prefix;
  return formatNumber(prefix, seq, { year });
}

/**
 * POST /invoices/:id/issue – the draft the caller is looking at (`expectedVersion`) gets its
 * number from the counter inside the transaction, `issuedAt/By` and a due date (today unless
 * set), and is locked from then on. No lines → 422 INVOICE_EMPTY. A total of 0 is paid at once.
 * The patient is told (no amounts in the email).
 */
export async function issueInvoice(
  user: AuthUser,
  id: string,
  { expectedVersion }: { expectedVersion: number },
  meta: RequestMeta,
  { now = new Date(), quiet = false }: SeedTimeOptions = {},
) {
  const inv = await loadForStaff(user, id, meta);
  assertTransition('invoice', inv.status, 'issued');
  if (inv.items.length === 0) {
    throw new ApiError(422, 'Add at least one line before issuing', ERROR_CODES.INVOICE_EMPTY);
  }
  if ((inv.__v ?? 0) !== expectedVersion) {
    throw ApiError.conflict('This invoice was changed by someone else. Reload it and check it.', {
      currentRevision: inv.__v ?? 0,
    });
  }
  const { timezone } = await getSettings();
  const free = inv.totalPaise === 0;
  if (free) assertTransition('invoice', 'issued', 'paid');

  const issued = await withTransaction(async (session) => {
    const invoiceNumber = await nextInvoiceNumber(session, now);
    const history = [
      { status: 'issued', at: now, by: user.id },
      ...(free ? [{ status: 'paid', at: now, by: user.id, note: 'Nothing to pay' }] : []),
    ];
    const updated = await Invoice.findOneAndUpdate(
      { _id: inv._id, status: 'draft', __v: expectedVersion },
      {
        $set: {
          status: free ? 'paid' : 'issued',
          invoiceNumber,
          issuedAt: now,
          issuedBy: user.id,
          dueDate: inv.dueDate ?? calendarDate(clinicToday(timezone, now)),
          balancePaise: inv.totalPaise,
          amountPaidPaise: 0,
          updatedBy: user.id,
        },
        $push: { statusHistory: { $each: history } },
        $inc: { __v: 1 },
      },
      { new: true, session },
    ).lean();
    if (!updated) {
      const fresh = await Invoice.findById(inv._id).select('status').session(session).lean();
      if (fresh && fresh.status !== 'draft') {
        throw invalidTransition('invoice', fresh.status, 'issued');
      }
      throw ApiError.conflict('This invoice was changed by someone else. Reload it and check it.');
    }
    return updated;
  });

  await audit.record({
    action: AUDIT_ACTIONS.INVOICE_ISSUE,
    actor: actorOf(user),
    resource: resourceOf(issued),
    patient: issued.patient,
    request: meta,
    metadata: { ...summaryOf(issued), status: issued.status },
  });
  if (!quiet) void notifyInvoiceIssued(issued);
  return toView(await loadInvoice(inv._id), user.role);
}

/** Tells the patient an invoice is ready – the number only, no amounts or lines (§10.3). */
async function notifyInvoiceIssued(inv: {
  _id: Types.ObjectId;
  patient: Types.ObjectId;
  invoiceNumber?: string | null;
}) {
  const settings = await getSettings();
  await notify({
    recipients: [await patientRecipient(inv.patient)],
    type: NOTIFICATION_TYPES.INVOICE_ISSUED,
    title: 'Your invoice is ready',
    body:
      `Your invoice ${inv.invoiceNumber ?? ''} from ${settings.name ?? 'the clinic'} is ready. ` +
      'Please log in to view it.',
    link: `/patient/invoices/${inv._id.toString()}`,
    email: true,
  });
}

/**
 * POST /invoices/:id/void – a draft, issued or partly paid invoice with nothing paid on it (net
 * of refunds); otherwise 422 VOID_REQUIRES_REFUND. The reason is kept on the invoice; the audit
 * entry records only that one was given.
 */
export async function voidInvoice(
  user: AuthUser,
  id: string,
  { reason }: { reason: string },
  meta: RequestMeta,
  { now = new Date() }: SeedTimeOptions = {},
) {
  const inv = await loadForStaff(user, id, meta);
  // Paid (or partly paid) invoices become voidable once refunded back to nothing paid.
  if (inv.status !== 'void' && inv.amountPaidPaise > 0) {
    throw new ApiError(
      422,
      'Money has been paid on this invoice. Refund the payments before voiding it.',
      ERROR_CODES.VOID_REQUIRES_REFUND,
      { amountPaidPaise: inv.amountPaidPaise },
    );
  }
  assertTransition('invoice', inv.status, 'void');
  const updated = await Invoice.findOneAndUpdate(
    { _id: inv._id, status: inv.status, amountPaidPaise: 0 },
    {
      $set: { status: 'void', void: { by: user.id, at: now, reason }, updatedBy: user.id },
      $push: { statusHistory: { status: 'void', at: now, by: user.id, note: reason } },
      $inc: { __v: 1 },
    },
    { new: true },
  ).lean();
  if (!updated) {
    const fresh = await Invoice.findById(inv._id).select('status amountPaidPaise').lean();
    if (fresh && fresh.amountPaidPaise > 0) {
      throw new ApiError(
        422,
        'Money has been paid on this invoice. Refund the payments before voiding it.',
        ERROR_CODES.VOID_REQUIRES_REFUND,
      );
    }
    throw invalidTransition('invoice', fresh?.status ?? inv.status, 'void');
  }
  await audit.record({
    action: AUDIT_ACTIONS.INVOICE_VOID,
    actor: actorOf(user),
    resource: resourceOf(updated),
    patient: updated.patient,
    request: meta,
    metadata: { fromStatus: inv.status, totalPaise: inv.totalPaise, reasonGiven: true },
  });
  return toView(await loadInvoice(inv._id), user.role);
}

/**
 * GET /invoices/:id/pdf – the invoice's readers (patients: their own; never a draft – staff get
 * 422, patients 404). Made on demand; audited `invoice.download`.
 */
export async function invoicePdf(user: AuthUser, id: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const inv = await loadInvoice(id);
  await assertCanReadInvoice(user, inv, meta);
  if (inv.status === 'draft') {
    throw ApiError.unprocessable('Issue the invoice before printing it');
  }
  const payments = (await Payment.find({ invoice: inv._id })
    .sort({ receivedAt: 1, _id: 1 })
    .lean()) as unknown as PaymentLike[];
  const buffer = await buildInvoicePdf(inv, payments);
  await audit.record({
    action: AUDIT_ACTIONS.INVOICE_DOWNLOAD,
    actor: actorOf(user),
    resource: resourceOf(inv),
    patient: patientIdOf(inv),
    request: meta,
    metadata: { status: inv.status },
  });
  return { buffer, fileName: `${inv.invoiceNumber ?? 'invoice'}.pdf` };
}
