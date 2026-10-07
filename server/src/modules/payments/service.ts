import type { ClientSession, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  INVOICE_OPEN_STATUSES,
  NOTIFICATION_TYPES,
  PAYMENT_METHODS,
  ROLES,
  SEQUENCES,
} from '../../config/constants.js';
import { assertCanReadInvoice } from '../../policies/invoiceAccess.js';
import * as audit from '../../services/audit.service.js';
import { formatNumber, nextSequence } from '../../services/counter.service.js';
import { notify } from '../../services/notification.service.js';
import type { AuthUser } from '../../types/express.js';
import { ApiError } from '../../utils/ApiError.js';
import { clinicToday, endOfClinicDay, startOfClinicDay, toClinicTime } from '../../utils/dates.js';
import { actorOf, type RequestMeta } from '../../utils/requestContext.js';
import { assertTransition, invalidTransition } from '../../utils/stateMachine.js';
import { withTransaction } from '../../utils/transaction.js';
import { patientRecipient } from '../appointments/service.js';
import { statusForAmounts } from '../invoices/calc.js';
import { Invoice, paymentWriteOptions } from '../invoices/model.js';
import { buildReceiptPdf } from '../invoices/pdf.js';
import { resourceOf as invoiceResource, type InvoiceLike } from '../invoices/serializer.js';
import { loadInvoice, viewFor } from '../invoices/service.js';
import { resolveMyPatientId } from '../patients/portal.service.js';
import { getSettings } from '../settings/service.js';
import { Payment } from './model.js';
import { resourceOf, shortName, toPaymentView, type PaymentLike } from './serializer.js';
import type { RecordPaymentInput, RefundInput } from './validation.js';

/**
 * Payments and refunds (spec §4.9, §6.22, §8.9). Both are one transaction: the payment record
 * (append-only, number from the counter) and a conditional update of the invoice on the version
 * read before (`__v`), its open status and – for payments – a balance that still covers the
 * amount. Two parallel payments can therefore never exceed the balance: the loser gets 409
 * CONFLICT (the invoice changed) or 422 PAYMENT_EXCEEDS_BALANCE. The paid amounts of an issued
 * invoice change only here (`paymentWriteOptions`).
 */

/** Seed only: back-date the record and skip the patient email. */
export interface PaymentOptions {
  now?: Date;
  quiet?: boolean;
}

const invoiceChanged = () =>
  ApiError.conflict('The invoice changed meanwhile. Please refresh it and try again.');

const exceedsBalance = (balancePaise: number) =>
  new ApiError(
    422,
    balancePaise === 0
      ? 'This invoice is fully paid'
      : 'The amount is more than the balance due on this invoice',
    ERROR_CODES.PAYMENT_EXCEEDS_BALANCE,
    { balancePaise },
  );

/** PAY-<clinic year>-000001, inside the caller's transaction (spec §8.10). */
async function nextPaymentNumber(session: ClientSession, at: Date) {
  const { timezone } = await getSettings();
  const year = Number(clinicToday(timezone, at).slice(0, 4));
  const seq = await nextSequence(`${SEQUENCES.PAYMENT.key}:${year}`, { session });
  return formatNumber(SEQUENCES.PAYMENT.prefix, seq, { year });
}

const historyFor = (from: string, to: string, by: string, at: Date, note?: string) =>
  from === to
    ? {}
    : { $push: { statusHistory: { status: to, at, by, ...(note ? { note } : {}) } } };

async function loadForStaff(user: AuthUser, invoiceId: string, meta: RequestMeta) {
  const inv = await loadInvoice(invoiceId);
  await assertCanReadInvoice(user, inv, meta);
  return inv;
}

/**
 * POST /invoices/:id/payments (reception) – on an issued or partly paid invoice, at most the
 * balance; the method must be enabled in the settings. The invoice becomes partially_paid, or
 * paid when nothing is left. The patient is told a receipt is available (no amounts).
 */
export async function recordPayment(
  user: AuthUser,
  invoiceId: string,
  input: RecordPaymentInput,
  meta: RequestMeta,
  { now = new Date(), quiet = false }: PaymentOptions = {},
) {
  const inv = await loadForStaff(user, invoiceId, meta);
  if (inv.status === 'paid') throw exceedsBalance(0);
  if (!(INVOICE_OPEN_STATUSES as readonly string[]).includes(inv.status)) {
    throw new ApiError(
      409,
      inv.status === 'draft'
        ? 'Issue the invoice before recording a payment'
        : 'This invoice is void and cannot be paid',
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      { from: inv.status, to: 'partially_paid' },
    );
  }
  const settings = await getSettings();
  const enabled = settings.billing?.paymentMethods ?? [...PAYMENT_METHODS];
  if (!enabled.includes(input.method)) {
    throw ApiError.unprocessable('This payment method is turned off in the clinic settings', [
      { field: 'body.method', message: 'Choose another payment method' },
    ]);
  }
  if (input.amountPaise > inv.balancePaise) throw exceedsBalance(inv.balancePaise);

  const amountPaidPaise = inv.amountPaidPaise + input.amountPaise;
  const balancePaise = inv.balancePaise - input.amountPaise;
  const status = statusForAmounts(inv.totalPaise, amountPaidPaise);
  assertTransition('invoice', inv.status, status);

  let payment;
  try {
    payment = await withTransaction(async (session) => {
      const updated = await Invoice.findOneAndUpdate(
        {
          _id: inv._id,
          __v: inv.__v,
          status: inv.status,
          balancePaise: { $gte: input.amountPaise },
        },
        {
          $set: { amountPaidPaise, balancePaise, status, updatedBy: user.id },
          ...historyFor(inv.status, status, user.id, now),
          $inc: { __v: 1 },
        },
        { new: true, ...paymentWriteOptions(session) },
      ).lean();
      if (!updated) throw invoiceChanged();
      const [created] = await Payment.create(
        [
          {
            paymentNumber: await nextPaymentNumber(session, now),
            invoice: inv._id,
            patient: inv.patient._id,
            amountPaise: input.amountPaise,
            method: input.method,
            ...(input.reference ? { reference: input.reference } : {}),
            kind: 'payment',
            receivedBy: user.id,
            receivedAt: now,
          },
        ],
        { session },
      );
      return created!;
    });
  } catch (err) {
    // Lost the race: the balance may now be too small (422) or the invoice simply changed (409).
    if (err instanceof ApiError && err.code === ERROR_CODES.CONFLICT) {
      const fresh = await Invoice.findById(inv._id).select('balancePaise status').lean();
      if (fresh && fresh.balancePaise < input.amountPaise) throw exceedsBalance(fresh.balancePaise);
    }
    throw err;
  }

  await audit.record({
    action: AUDIT_ACTIONS.PAYMENT_CREATE,
    actor: actorOf(user),
    resource: resourceOf(payment),
    patient: inv.patient._id,
    request: meta,
    metadata: {
      invoiceNumber: inv.invoiceNumber,
      amountPaise: input.amountPaise,
      method: input.method,
      referenceGiven: Boolean(input.reference),
      invoiceStatus: status,
      balancePaise,
    },
  });
  if (!quiet) void notifyPaymentReceived(inv);
  return {
    payment: toPaymentView(payment as unknown as PaymentLike, user.role),
    invoice: await viewFor(user, await loadInvoice(inv._id)),
  };
}

/** "Your receipt is available" – the invoice number only, no amounts (§10.3). */
async function notifyPaymentReceived(inv: InvoiceLike) {
  const settings = await getSettings();
  await notify({
    recipients: [await patientRecipient(inv.patient._id)],
    type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
    title: 'Payment received',
    body:
      `${settings.name ?? 'The clinic'} has received a payment for invoice ` +
      `${inv.invoiceNumber ?? ''}. Your receipt is available – please log in to view it.`,
    link: `/patient/invoices/${inv._id.toString()}`,
    email: true,
  });
}

/** Refunded so far per payment id (refund amounts are negative; returned as positive). */
async function refundedByPayment(paymentIds: Types.ObjectId[], session?: ClientSession) {
  const rows = await Payment.aggregate<{ _id: Types.ObjectId; refunded: number }>([
    { $match: { kind: 'refund', refundOf: { $in: paymentIds } } },
    { $group: { _id: '$refundOf', refunded: { $sum: { $multiply: ['$amountPaise', -1] } } } },
  ]).session(session ?? null);
  return new Map(rows.map((r) => [r._id.toString(), r.refunded]));
}

/**
 * POST /payments/:id/refund (reception, admin) – returns up to what is left of the payment
 * (original minus earlier refunds; else 422 REFUND_EXCEEDS_PAYMENT) as a negative payment linked
 * to it, with a reason. The invoice's paid amount drops: paid → partially_paid, or issued when
 * nothing remains paid. Parallel refunds are serialised by the invoice version.
 */
export async function refundPayment(
  user: AuthUser,
  paymentId: string,
  input: RefundInput,
  meta: RequestMeta,
  { now = new Date() }: PaymentOptions = {},
) {
  const original = await Payment.findById(paymentId).lean();
  if (!original) throw ApiError.notFound('Payment not found');
  const inv = await loadForStaff(user, original.invoice.toString(), meta);
  if (original.kind !== 'payment') {
    throw ApiError.unprocessable('A refund cannot be refunded', [
      { field: 'params.id', message: 'Choose the original payment' },
    ]);
  }
  const refunded = (await refundedByPayment([original._id])).get(original._id.toString()) ?? 0;
  const refundable = original.amountPaise - refunded;
  if (input.amountPaise > refundable) {
    throw new ApiError(
      422,
      refundable === 0
        ? 'This payment has already been refunded in full'
        : 'The refund is more than what is left of this payment',
      ERROR_CODES.REFUND_EXCEEDS_PAYMENT,
      { refundablePaise: refundable },
    );
  }
  const amountPaidPaise = inv.amountPaidPaise - input.amountPaise;
  const balancePaise = inv.balancePaise + input.amountPaise;
  const status = statusForAmounts(inv.totalPaise, amountPaidPaise);
  if (amountPaidPaise < 0) throw invoiceChanged();
  assertTransition('invoice', inv.status, status);

  const refund = await withTransaction(async (session) => {
    // Re-check inside the transaction: refunds of this payment committed meanwhile count.
    const again =
      (await refundedByPayment([original._id], session)).get(original._id.toString()) ?? 0;
    if (input.amountPaise > original.amountPaise - again) {
      throw new ApiError(
        422,
        'The refund is more than what is left of this payment',
        ERROR_CODES.REFUND_EXCEEDS_PAYMENT,
        { refundablePaise: original.amountPaise - again },
      );
    }
    const updated = await Invoice.findOneAndUpdate(
      { _id: inv._id, __v: inv.__v, status: inv.status },
      {
        $set: { amountPaidPaise, balancePaise, status, updatedBy: user.id },
        ...historyFor(inv.status, status, user.id, now, 'Refund'),
        $inc: { __v: 1 },
      },
      { new: true, ...paymentWriteOptions(session) },
    ).lean();
    if (!updated) {
      const fresh = await Invoice.findById(inv._id).select('status').session(session).lean();
      if (fresh?.status === 'void') throw invalidTransition('invoice', 'void', status);
      throw invoiceChanged();
    }
    const [created] = await Payment.create(
      [
        {
          paymentNumber: await nextPaymentNumber(session, now),
          invoice: inv._id,
          patient: inv.patient._id,
          amountPaise: -input.amountPaise,
          method: original.method,
          kind: 'refund',
          refundOf: original._id,
          reason: input.reason,
          receivedBy: user.id,
          receivedAt: now,
        },
      ],
      { session },
    );
    return created!;
  });

  await audit.record({
    action: AUDIT_ACTIONS.PAYMENT_REFUND,
    actor: actorOf(user),
    resource: resourceOf(refund),
    patient: inv.patient._id,
    request: meta,
    metadata: {
      refundOf: original.paymentNumber,
      invoiceNumber: inv.invoiceNumber,
      amountPaise: input.amountPaise,
      method: original.method,
      invoiceStatus: status,
      reasonGiven: true,
    },
  });
  return {
    refund: toPaymentView(refund as unknown as PaymentLike, user.role),
    invoice: await viewFor(user, await loadInvoice(inv._id)),
  };
}

const PAYMENT_POPULATE = [
  { path: 'receivedBy', select: 'firstName lastName' },
  { path: 'invoice', select: 'invoiceNumber' },
] as const;

/**
 * GET /invoices/:id/payments – the invoice's readers (patients: their own issued invoices),
 * oldest first, each payment with what has been refunded of it. Audited `payment.view`
 * (debounced).
 */
export async function listPaymentsForInvoice(user: AuthUser, invoiceId: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const inv = await loadInvoice(invoiceId);
  await assertCanReadInvoice(user, inv, meta);
  const payments = (await Payment.find({ invoice: inv._id })
    .sort({ receivedAt: 1, _id: 1 })
    .populate([...PAYMENT_POPULATE])
    .lean()) as unknown as PaymentLike[];
  const refunded = await refundedByPayment(payments.map((p) => p._id));
  await audit.recordRead({
    action: AUDIT_ACTIONS.PAYMENT_VIEW,
    actor: actorOf(user),
    resource: invoiceResource(inv),
    patient: inv.patient._id,
    request: meta,
  });
  return payments.map((p) => toPaymentView(p, user.role, refunded.get(p._id.toString()) ?? 0));
}

/** A payment (refund) with its invoice, readable by the invoice's readers. 404 otherwise. */
export async function loadPaymentForReader(user: AuthUser, paymentId: string, meta: RequestMeta) {
  if (user.role === ROLES.PATIENT) await resolveMyPatientId(user);
  const payment = await Payment.findById(paymentId)
    .populate([...PAYMENT_POPULATE, { path: 'patient', select: 'firstName lastName mrn' }])
    .lean();
  if (!payment) throw ApiError.notFound('Payment not found');
  const inv = await loadInvoice((payment.invoice as unknown as { _id: Types.ObjectId })._id);
  await assertCanReadInvoice(user, inv, meta);
  return { payment: payment as unknown as PaymentLike, invoice: inv };
}

interface MethodTotals {
  method: string;
  paymentCount: number;
  collectedPaise: number;
  refundCount: number;
  refundedPaise: number;
  netPaise: number;
}

/**
 * GET /payments/summary?date= (reception, admin) – the clinic day's collections for the day
 * close: per method the payments and refunds (counts, amounts) and the net, the day's totals,
 * and every payment/refund in time order (number, time, invoice, patient short name, method,
 * amount, received by). Day boundaries in the clinic timezone.
 */
export async function daySummary(date?: string) {
  const { timezone } = await getSettings();
  const day = date ?? clinicToday(timezone);
  const rows = (await Payment.find({
    receivedAt: { $gte: startOfClinicDay(day, timezone), $lte: endOfClinicDay(day, timezone) },
  })
    .sort({ receivedAt: 1, _id: 1 })
    .populate([...PAYMENT_POPULATE, { path: 'patient', select: 'firstName lastName' }])
    .lean()) as unknown as PaymentLike[];

  const empty = (method: string): MethodTotals => ({
    method,
    paymentCount: 0,
    collectedPaise: 0,
    refundCount: 0,
    refundedPaise: 0,
    netPaise: 0,
  });
  const byMethod = new Map(PAYMENT_METHODS.map((m) => [m as string, empty(m)]));
  const totals = empty('all');
  for (const p of rows) {
    const m = byMethod.get(p.method) ?? empty(p.method);
    byMethod.set(p.method, m);
    for (const t of [m, totals]) {
      if (p.kind === 'refund') {
        t.refundCount += 1;
        t.refundedPaise += -p.amountPaise;
      } else {
        t.paymentCount += 1;
        t.collectedPaise += p.amountPaise;
      }
      t.netPaise += p.amountPaise;
    }
  }
  return {
    date: day,
    timezone,
    byMethod: [...byMethod.values()],
    totals: {
      paymentCount: totals.paymentCount,
      collectedPaise: totals.collectedPaise,
      refundCount: totals.refundCount,
      refundedPaise: totals.refundedPaise,
      netPaise: totals.netPaise,
    },
    payments: rows.map((p) => {
      const invoice = p.invoice as { _id: Types.ObjectId; invoiceNumber?: string | null };
      return {
        id: p._id.toString(),
        paymentNumber: p.paymentNumber,
        kind: p.kind,
        time: toClinicTime(p.receivedAt, timezone),
        receivedAt: p.receivedAt,
        invoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber ?? null,
        patientName: shortName(p.patient),
        method: p.method,
        amountPaise: p.amountPaise,
        receivedByName:
          'firstName' in p.receivedBy
            ? `${p.receivedBy.firstName} ${p.receivedBy.lastName ?? ''}`.trim()
            : null,
      };
    }),
  };
}

/**
 * GET /payments/:id/receipt.pdf – the invoice's readers (patients: their own). Made on demand;
 * audited `payment.receipt_download`.
 */
export async function receiptPdf(user: AuthUser, paymentId: string, meta: RequestMeta) {
  const { payment, invoice } = await loadPaymentForReader(user, paymentId, meta);
  const original = payment.refundOf
    ? await Payment.findById(payment.refundOf).select('paymentNumber').lean()
    : null;
  const buffer = await buildReceiptPdf(
    payment as Parameters<typeof buildReceiptPdf>[0],
    invoice,
    original?.paymentNumber ?? null,
  );
  await audit.record({
    action: AUDIT_ACTIONS.PAYMENT_RECEIPT_DOWNLOAD,
    actor: actorOf(user),
    resource: resourceOf(payment),
    patient: invoice.patient._id,
    request: meta,
    metadata: { kind: payment.kind, invoiceNumber: invoice.invoiceNumber },
  });
  return { buffer, fileName: `${payment.paymentNumber}.pdf` };
}
