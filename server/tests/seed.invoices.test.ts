import { Appointment } from '../src/modules/appointments/model.js';
import { DoctorProfile } from '../src/modules/doctors/model.js';
import { NoteAmendment } from '../src/modules/encounters/amendment.model.js';
import { Encounter } from '../src/modules/encounters/model.js';
import { calcInvoice } from '../src/modules/invoices/calc.js';
import { Invoice } from '../src/modules/invoices/model.js';
import { LabOrder } from '../src/modules/labOrders/model.js';
import { Payment } from '../src/modules/payments/model.js';
import { Prescription } from '../src/modules/prescriptions/model.js';
import { DoctorSchedule } from '../src/modules/schedules/model.js';
import { User } from '../src/modules/users/model.js';
import { runSeed } from '../src/seed/index.js';
import { clinicToday, startOfClinicDay } from '../src/utils/dates.js';
import { resetDb } from './helpers/auth.js';
import { captureEmails } from './helpers/email.js';

/** Invoices and payments of the demo seed (spec §15.3, Phase 7). */

let summary: Awaited<ReturnType<typeof runSeed>>;
let emails: ReturnType<typeof captureEmails>;
beforeAll(async () => {
  await Promise.all([
    DoctorProfile.init(),
    DoctorSchedule.init(),
    Appointment.init(),
    Encounter.init(),
    Prescription.init(),
    NoteAmendment.init(),
    LabOrder.init(),
    Invoice.init(),
    Payment.init(),
  ]);
  await resetDb();
  emails = captureEmails();
  summary = await runSeed();
  emails.restore();
}, 180_000);

describe('seeded invoices', () => {
  it('one invoice per completed visit with a signed note, in the planned mix', async () => {
    const s = summary.invoices!;
    const visits = await Appointment.countDocuments({ status: 'completed' });
    expect(s.created).toBeGreaterThan(100);
    expect(s.created).toBeLessThanOrEqual(visits);
    expect(s.paid!).toBeGreaterThan(s.created! * 0.5);
    expect(s.partially_paid).toBeGreaterThan(0);
    expect(s.issued).toBeGreaterThan(0);
    expect(s.draft).toBeGreaterThan(0);
    expect(s).toMatchObject({
      void: 2,
      voided: 2,
      refunds: 2,
      refundRecords: 2,
      adminDiscounts: 1,
      supplementary: 1,
      cancelledItemsFlagged: 1,
    });
    expect(s.discounts).toBeGreaterThan(3);
    expect(s.billedRupees).toBeGreaterThan(0);
    expect(s.collectedRupees).toBeGreaterThan(0);
    expect(s.collectedRupees).toBeLessThanOrEqual(s.billedRupees!);
    expect(emails.sent).toHaveLength(0); // notifications are muted while seeding
  });

  it('every invoice adds up: lines, totals, payments and balance', async () => {
    const invoices = await Invoice.find().lean();
    const payments = await Payment.find().lean();
    for (const inv of invoices) {
      const net = payments
        .filter((p) => p.invoice.equals(inv._id))
        .reduce((sum, p) => sum + p.amountPaise, 0);
      expect(inv.amountPaidPaise, inv._id.toString()).toBe(net);
      const totals = calcInvoice(inv.items, inv.amountPaidPaise);
      expect(inv).toMatchObject(totals);
      for (const line of inv.items) {
        expect(line.taxPaise + line.unitPricePaise * line.quantity - line.discountPaise).toBe(
          line.lineTotalPaise,
        );
      }
      if (inv.status === 'paid') expect(inv.balancePaise).toBe(0);
      if (inv.status === 'void') expect(inv.amountPaidPaise).toBe(0);
    }
    // Numbers are unique and continue the counter: INV-<year>-000001 … per year.
    const numbers = invoices.map((i) => i.invoiceNumber).filter(Boolean) as string[];
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(invoices.filter((i) => i.status === 'draft').every((i) => !i.invoiceNumber)).toBe(true);
  });

  it('back-dated to the visits; today’s completed visits wait at reception', async () => {
    const tz = 'Asia/Kolkata';
    const startToday = startOfClinicDay(clinicToday(tz), tz);
    const issued = await Invoice.find({ issuedAt: { $exists: true } }).lean();
    expect(issued.some((i) => i.issuedAt! < startToday)).toBe(true);
    expect(issued.every((i) => i.issuedAt! <= new Date())).toBe(true);

    const todays = await Appointment.find({
      status: 'completed',
      startAt: { $gte: startToday },
    }).lean();
    const todaysInvoices = await Invoice.find({
      appointment: { $in: todays.map((a) => a._id) },
      kind: 'appointment',
    }).lean();
    for (const inv of todaysInvoices) expect(['draft', 'issued']).toContain(inv.status);
  });

  it('patient1 has an unpaid invoice; the specials are in place', async () => {
    const p1 = await User.findOne({ email: 'patient1@medassist.dev' }).lean();
    const own = await Invoice.find({ patient: p1!.patient }).lean();
    expect(own.some((i) => i.status === 'issued' && i.balancePaise > 0)).toBe(true);

    const supplementary = await Invoice.findOne({ kind: 'supplementary' }).lean();
    expect(supplementary).toMatchObject({ status: 'paid' });
    expect(supplementary!.items.map((l) => l.kind)).toEqual(['lab_test']);
    const flagged = await Invoice.findOne({ 'cancelledItemsBilled.0': { $exists: true } }).lean();
    expect(flagged!.status).not.toBe('draft');
    const approved = await Invoice.findOne({ 'discountApproval.at': { $exists: true } }).lean();
    expect(approved!.discountTotalPaise * 100).toBeGreaterThan(approved!.subtotalPaise * 10);
  });

  it('a second run changes nothing', async () => {
    const before = await Invoice.countDocuments();
    const again = await runSeed();
    expect(again.invoices).toMatchObject({ created: 0, unchanged: before });
    expect(await Invoice.countDocuments()).toBe(before);
  }, 120_000);
});
