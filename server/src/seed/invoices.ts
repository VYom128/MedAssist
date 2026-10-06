import { faker } from '@faker-js/faker';
import type { Types } from 'mongoose';
import { LAB_ITEM_CANCELLABLE_IN, ROLES, type PaymentMethod } from '../config/constants.js';
import { Appointment } from '../modules/appointments/model.js';
import { Encounter } from '../modules/encounters/model.js';
import { Invoice } from '../modules/invoices/model.js';
import { issueInvoice, updateInvoice, voidInvoice } from '../modules/invoices/service.js';
import {
  addLabOrderToInvoice,
  afterInvoiceSync,
  createOrUpdateDraftForAppointment,
} from '../modules/invoices/sync.service.js';
import { LabOrder } from '../modules/labOrders/model.js';
import { cancelLabOrderItem, insertPlacedOrderForSeed } from '../modules/labOrders/service.js';
import { LabTest } from '../modules/labTests/model.js';
import { Payment } from '../modules/payments/model.js';
import { recordPayment, refundPayment } from '../modules/payments/service.js';
import { getSettings } from '../modules/settings/service.js';
import { User } from '../modules/users/model.js';
import type { AuthUser } from '../types/express.js';
import { clinicToday, daysBetween, toClinicDate } from '../utils/dates.js';
import { withTransaction } from '../utils/transaction.js';
import { SEED_REQUEST, seedActor } from './context.js';
import { doctorActor, seedFor } from './encounters.js';

/**
 * Invoices and payments (spec §15.3, Phase 7), after the lab orders: every completed visit with a
 * signed note gets its draft through the REAL signing path (createOrUpdateDraftForAppointment:
 * consultation + placed lab tests), then reception (reception1) issues and takes payments through
 * the services, back-dated to the visit (issued ~15 min after it, paid a few minutes later).
 *
 * Mix (deterministic per appointment number): ~5 % drafts (the latest past visits), ~70 % paid
 * (cash / UPI / card / insurance, with references), ~10 % partly paid, ~10–15 % issued unpaid;
 * today's completed visits wait at reception as drafts or unpaid invoices; patient1's latest past
 * visit is unpaid ("please pay at the clinic reception"). Specials: small reception discounts,
 * one admin-approved larger discount, two voided invoices (one after a full refund), one partial
 * refund, one supplementary invoice for a test ordered after the visit was billed, and one
 * issued invoice with a cancelled test listed for a refund. Run once: when any invoice exists the
 * seeder only reports the counts. `--reset` clears invoices and payments.
 */

const MINUTE = 60_000;
const SMALL_DISCOUNT_EVERY = 9;
const SMALL_DISCOUNT_PERCENT = 5;
const ADMIN_DISCOUNT_PERCENT = 25;
/** Of past visits: drafts (the latest), then paid / partly paid / issued by a per-visit draw. */
const DRAFT_SHARE = 0.05;
const PAID_BELOW = 0.78;
const PARTIAL_BELOW = 0.885;

type Outcome = 'draft' | 'issued' | 'partial' | 'paid';

interface Visit {
  appointment: {
    _id: Types.ObjectId;
    appointmentNumber: string;
    startAt: Date;
    endAt: Date;
    patient: Types.ObjectId;
    doctor: Types.ObjectId;
  };
  encounter: {
    _id: Types.ObjectId;
    patient: Types.ObjectId;
    appointment: Types.ObjectId;
    signedAt?: Date | null;
  };
  invoiceId: string;
  daysAgo: number;
}

/** Never in the future (today's visits). */
const notAfterNow = (d: Date) => new Date(Math.min(d.getTime(), Date.now()));

/** A plausible method and reference. */
function paymentMethod(): { method: PaymentMethod; reference: string | undefined } {
  const r = faker.number.float();
  if (r < 0.4) return { method: 'cash', reference: undefined };
  if (r < 0.75) return { method: 'upi', reference: `UPI${faker.string.numeric(12)}` };
  if (r < 0.95) return { method: 'card', reference: `SLIP ${faker.string.numeric(6)}` };
  return {
    method: 'insurance',
    reference: `CLM-${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`,
  };
}

/** Whole rupees of `percent` of the line (never more than the line). */
const percentOf = (paise: number, percent: number) =>
  Math.min(paise, Math.round((paise * percent) / 100 / 100) * 100);

export async function seedInvoices(): Promise<Record<string, number>> {
  const existing = await Invoice.estimatedDocumentCount();
  if (existing > 0) return { created: 0, unchanged: existing, ...(await billingCounts()) };

  const { timezone } = await getSettings();
  const today = clinicToday(timezone);
  const reception = await seedActor('reception1@medassist.dev', ROLES.RECEPTIONIST);
  const admin = await seedActor();
  const lab1 = await seedActor('lab1@medassist.dev', ROLES.LABTECH);
  const patient1 = (
    await User.findOne({ email: 'patient1@medassist.dev' }).select('patient').lean()
  )?.patient;

  // Completed visits with a signed note, oldest first (invoice numbers follow the visits).
  const notes = await Encounter.find({ status: { $in: ['signed', 'amended'] } })
    .select('appointment patient doctor signedAt')
    .lean();
  const noteByAppt = new Map(notes.map((n) => [n.appointment.toString(), n]));
  const appointments = await Appointment.find({
    _id: { $in: notes.map((n) => n.appointment) },
    status: 'completed',
  })
    .select('appointmentNumber startAt endAt patient doctor')
    .sort({ startAt: 1, appointmentNumber: 1 })
    .lean();

  const doctors = new Map<string, AuthUser>();
  const doctorFor = async (id: Types.ObjectId) => {
    if (!doctors.has(id.toString())) doctors.set(id.toString(), await doctorActor(id));
    return doctors.get(id.toString())!;
  };

  // 1. The drafts, exactly as signing makes them.
  const visits: Visit[] = [];
  for (const appt of appointments) {
    const note = noteByAppt.get(appt._id.toString())!;
    const doctor = await doctorFor(appt.doctor);
    const synced = await withTransaction((session) =>
      createOrUpdateDraftForAppointment(appt._id, {
        session,
        by: doctor.id,
        now: note.signedAt ?? appt.endAt,
      }),
    );
    await afterInvoiceSync(doctor, [synced], SEED_REQUEST, 'sign');
    if (!synced) continue;
    visits.push({
      appointment: appt,
      encounter: note,
      invoiceId: synced.invoice._id.toString(),
      daysAgo: daysBetween(toClinicDate(appt.startAt, timezone), today),
    });
  }

  // 2. What happens to each (deterministic per visit).
  const latestPatient1 = [...visits]
    .reverse()
    .find((v) => v.daysAgo > 0 && patient1 && v.appointment.patient.equals(patient1));
  // The most recent ~5 % of past visits are still drafts (reception has not billed them yet).
  const past = visits.filter((v) => v.daysAgo > 0);
  const recentDrafts = new Set(past.slice(Math.floor(past.length * (1 - DRAFT_SHARE))));
  const outcomes = visits.map((v): Outcome => {
    faker.seed(seedFor(`invoice:${v.appointment.appointmentNumber}`));
    const r = faker.number.float();
    if (v.daysAgo === 0) return r < 0.5 ? 'draft' : 'issued';
    if (v === latestPatient1) return 'issued';
    if (recentDrafts.has(v)) return 'draft';
    if (r < PAID_BELOW) return 'paid';
    if (r < PARTIAL_BELOW) return 'partial';
    return 'issued';
  });

  const result = {
    created: visits.length,
    discounts: 0,
    adminDiscounts: 0,
    payments: 0,
    refunds: 0,
    voided: 0,
    supplementary: 0,
    cancelledItemsFlagged: 0,
  };
  const specials = { voidAfterRefund: false, voidUnpaid: false, partialRefund: false };
  const paidVisits: Visit[] = [];
  let adminDiscountGiven = false;

  for (const [index, v] of visits.entries()) {
    const outcome = outcomes[index]!;
    if (outcome === 'draft') continue;
    faker.seed(seedFor(`payment:${v.appointment.appointmentNumber}`));
    const issuedAt = notAfterNow(new Date(v.appointment.endAt.getTime() + 15 * MINUTE));
    let inv = await Invoice.findById(v.invoiceId).lean();
    const consultation = inv!.items.find((l) => l.kind === 'consultation');

    // Discounts before issue: small ones at the desk, one larger one approved by the admin.
    const adminDiscount = !adminDiscountGiven && outcome === 'paid' && index >= 10;
    const smallDiscount = !adminDiscount && index % SMALL_DISCOUNT_EVERY === 4;
    if (consultation && (adminDiscount || smallDiscount)) {
      const percent = adminDiscount ? ADMIN_DISCOUNT_PERCENT : SMALL_DISCOUNT_PERCENT;
      await updateInvoice(
        adminDiscount ? admin : reception,
        v.invoiceId,
        {
          expectedVersion: inv!.__v,
          items: inv!.items.map((l) => ({
            id: l._id.toString(),
            ...(l === consultation
              ? { discountPaise: percentOf(l.unitPricePaise * l.quantity, percent) }
              : {}),
          })),
          ...(adminDiscount ? { notes: 'Senior citizen concession approved by the admin' } : {}),
        },
        SEED_REQUEST,
      );
      if (adminDiscount) {
        adminDiscountGiven = true;
        result.adminDiscounts += 1;
      } else {
        result.discounts += 1;
      }
      inv = await Invoice.findById(v.invoiceId).lean();
    }

    const issued = await issueInvoice(
      reception,
      v.invoiceId,
      { expectedVersion: inv!.__v },
      SEED_REQUEST,
      { now: issuedAt, quiet: true },
    );

    // One unpaid invoice voided (raised twice).
    if (outcome === 'issued' && v.daysAgo > 0 && v !== latestPatient1 && !specials.voidUnpaid) {
      specials.voidUnpaid = true;
      await voidInvoice(
        reception,
        v.invoiceId,
        { reason: 'Duplicate invoice – the visit was billed twice' },
        SEED_REQUEST,
        { now: new Date(issuedAt.getTime() + 30 * MINUTE) },
      );
      result.voided += 1;
      continue;
    }
    if (outcome === 'issued') continue;

    const paidAt = new Date(issuedAt.getTime() + 5 * MINUTE);
    const amount =
      outcome === 'partial'
        ? Math.max(100, Math.round((issued.totalPaise * 0.4) / 10_000) * 10_000)
        : issued.balancePaise;
    if (amount <= 0 || amount > issued.balancePaise) continue;
    const { payment } = await recordPayment(
      reception,
      v.invoiceId,
      { amountPaise: amount, ...paymentMethod() },
      SEED_REQUEST,
      { now: notAfterNow(paidAt), quiet: true },
    );
    result.payments += 1;
    if (outcome !== 'paid' || v.daysAgo === 0) continue;

    const refundAt = notAfterNow(new Date(paidAt.getTime() + 60 * MINUTE));
    if (!specials.voidAfterRefund && index >= 3) {
      // Billed against the wrong record: refunded in full, then voided.
      specials.voidAfterRefund = true;
      await refundPayment(
        reception,
        payment.id as string,
        { amountPaise: amount, reason: 'Billed against the wrong patient record' },
        SEED_REQUEST,
        { now: refundAt },
      );
      await voidInvoice(
        reception,
        v.invoiceId,
        { reason: 'Raised against the wrong patient record' },
        SEED_REQUEST,
        { now: new Date(refundAt.getTime() + MINUTE) },
      );
      result.refunds += 1;
      result.voided += 1;
      continue;
    }
    if (!specials.partialRefund && amount >= 20_000 && index >= 6) {
      specials.partialRefund = true;
      await refundPayment(
        reception,
        payment.id as string,
        {
          amountPaise: Math.round(amount / 4 / 100) * 100,
          reason: 'Goodwill refund – long waiting time at the clinic',
        },
        SEED_REQUEST,
        { now: refundAt },
      );
      result.refunds += 1;
      continue;
    }
    paidVisits.push(v);
  }

  // A test ordered after the visit was billed and paid → a supplementary invoice, paid too.
  const lateTest = await LabTest.findOne({ isActive: true })
    .sort({ pricePaise: 1, code: 1 })
    .lean();
  const late = [...paidVisits].reverse().find((v) => v.daysAgo >= 1);
  let lateOrderId: string | null = null;
  if (lateTest && late) {
    const doctor = await doctorFor(late.appointment.doctor);
    const orderedAt = notAfterNow(new Date(late.appointment.endAt.getTime() + 2 * 60 * MINUTE));
    const order = await insertPlacedOrderForSeed(
      {
        doctor,
        encounter: late.encounter,
        testIds: [lateTest._id.toString()],
        clinicalNotes: 'Added after reviewing the history',
        orderedAt,
      },
      SEED_REQUEST,
    );
    lateOrderId = order._id.toString();
    const synced = await withTransaction((session) =>
      addLabOrderToInvoice(
        { appointment: late.appointment._id },
        { session, by: doctor.id, now: orderedAt },
      ),
    );
    await afterInvoiceSync(doctor, [synced], SEED_REQUEST, 'lab_order');
    if (synced) {
      const supplementaryId = synced.invoice._id.toString();
      const issuedAt = new Date(orderedAt.getTime() + 10 * MINUTE);
      const issued = await issueInvoice(
        reception,
        supplementaryId,
        { expectedVersion: 0 },
        SEED_REQUEST,
        {
          now: notAfterNow(issuedAt),
          quiet: true,
        },
      );
      faker.seed(seedFor(`supplementary:${late.appointment.appointmentNumber}`));
      await recordPayment(
        reception,
        supplementaryId,
        { amountPaise: issued.balancePaise, ...paymentMethod() },
        SEED_REQUEST,
        { now: notAfterNow(new Date(issuedAt.getTime() + 5 * MINUTE)), quiet: true },
      );
      result.supplementary += 1;
      result.payments += 1;
    }
  }

  // A test cancelled after its invoice was issued: listed on the invoice for reception to refund.
  const cancellable = await LabOrder.find({
    status: { $in: LAB_ITEM_CANCELLABLE_IN },
    'items.status': 'pending',
  })
    .select('items appointment')
    .sort({ orderedAt: -1 })
    .lean();
  // Prefer an order with another open test, so the order itself stays open.
  const openTests = (o: (typeof cancellable)[number]) =>
    o.items.filter((i) => i.status === 'pending').length;
  cancellable.sort((a, b) => Number(openTests(b) > 1) - Number(openTests(a) > 1));
  for (const order of cancellable) {
    if (order._id.toString() === lateOrderId) continue;
    const item = [...order.items].reverse().find((i) => i.status === 'pending');
    const billed = await Invoice.findOne({
      status: { $in: ['issued', 'partially_paid', 'paid'] },
      'items.labOrderItem': item?._id,
    }).lean();
    if (!item || !billed) continue;
    await cancelLabOrderItem(
      lab1,
      order._id.toString(),
      item._id.toString(),
      { reason: 'Reagent out of stock – test not done' },
      SEED_REQUEST,
    );
    result.cancelledItemsFlagged += 1;
    break;
  }

  return { ...result, ...(await billingCounts()) };
}

/** Invoices per status, payments, refunds and the money, for the seed summary. */
async function billingCounts(): Promise<Record<string, number>> {
  const [byStatus, money, payments] = await Promise.all([
    Invoice.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Invoice.aggregate<{ billed: number }>([
      { $match: { status: { $in: ['issued', 'partially_paid', 'paid'] } } },
      { $group: { _id: null, billed: { $sum: '$totalPaise' } } },
    ]),
    Payment.aggregate<{ _id: string; n: number; total: number }>([
      { $group: { _id: '$kind', n: { $sum: 1 }, total: { $sum: '$amountPaise' } } },
    ]),
  ]);
  const kind = (k: string) => payments.find((p) => p._id === k);
  const collected = (kind('payment')?.total ?? 0) + (kind('refund')?.total ?? 0);
  return {
    ...Object.fromEntries(
      byStatus.sort((a, b) => a._id.localeCompare(b._id)).map((r) => [r._id, r.n]),
    ),
    paymentRecords: kind('payment')?.n ?? 0,
    refundRecords: kind('refund')?.n ?? 0,
    billedRupees: Math.round((money[0]?.billed ?? 0) / 100),
    collectedRupees: Math.round(collected / 100),
  };
}
