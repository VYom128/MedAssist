import {
  clinicHeader,
  createPdf,
  detailsGrid,
  heading,
  paragraph,
  rule,
  table,
  PDF_LAYOUT,
  type PdfHandle,
} from '../../services/pdf.service.js';
import { amountInWords } from '../../utils/amountInWords.js';
import { calendarDateString, formatClinicDateTime, toClinicDate } from '../../utils/dates.js';
import { formatPhone } from '../../utils/phone.js';
import type { PaymentLike } from '../payments/serializer.js';
import { maskReference } from '../payments/serializer.js';
import { getSettings } from '../settings/service.js';
import type { InvoiceLike } from './serializer.js';

/**
 * Invoice and receipt PDFs (spec §12.3), made on demand from the locked data (Phase 7 decision:
 * not stored as Documents – an issued invoice and its payments never change, so the PDF is
 * always the same). Embedded Noto Sans so amounts print with ₹ ("Rs." if the font is missing).
 */

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  insurance: 'Insurance',
  other: 'Other',
};
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  issued: 'Issued – unpaid',
  partially_paid: 'Partly paid',
  paid: 'Paid',
  void: 'Void',
};

type Person = { firstName?: string; lastName?: string } | null | undefined;
const nameOf = (p: Person) => (p?.firstName ? `${p.firstName} ${p.lastName ?? ''}`.trim() : '–');
const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

/** Label/amount rows aligned to the right (totals). */
function totalsBlock(pdf: PdfHandle, rows: [string, string, boolean?][]) {
  const { doc, width } = pdf;
  const { margin, colors } = PDF_LAYOUT;
  const labelX = margin + width * 0.5;
  const labelWidth = width * 0.3;
  const valueX = labelX + labelWidth;
  const valueWidth = width * 0.2;
  for (const [label, value, strong] of rows) {
    const y = doc.y;
    doc
      .font(strong ? pdf.fonts.bold : pdf.fonts.regular)
      .fontSize(strong ? 10.5 : 9)
      .fillColor(strong ? colors.ink : colors.muted)
      .text(pdf.safe(label), labelX, y, { width: labelWidth });
    doc
      .fillColor(colors.ink)
      .text(pdf.safe(value), valueX, y, { width: valueWidth, align: 'right' });
    doc.x = margin;
    doc.y = Math.max(doc.y, y + 14);
  }
}

/**
 * The invoice (staff and its patient; never a draft): clinic header with GSTIN and registration
 * number, "TAX INVOICE" when the clinic has a GSTIN, number and dates, patient and visit,
 * lines, totals with the amount in words, payments received, balance due, a VOID watermark when
 * voided, and the clinic's invoice footer.
 */
export async function buildInvoicePdf(
  inv: InvoiceLike,
  payments: readonly PaymentLike[],
): Promise<Buffer> {
  const settings = await getSettings();
  const { timezone } = settings;
  const taxLabel = settings.billing?.taxLabel || 'Tax';
  const number = inv.invoiceNumber ?? '–';
  const pdf = createPdf({
    title: `Invoice ${number}`,
    subject: 'Invoice',
    unicode: true,
    ...(inv.status === 'void' ? { watermark: 'VOID' } : {}),
  });
  const date = (d?: Date | null) => (d ? toClinicDate(d, timezone) : '–');

  await clinicHeader(pdf, settings.gstin ? 'TAX INVOICE' : 'INVOICE');
  const appt = inv.appointment;
  detailsGrid(pdf, [
    ['Invoice number', number],
    ['Patient', nameOf(inv.patient)],
    ['Invoice date', date(inv.issuedAt)],
    ['MRN', inv.patient.mrn ?? '–'],
    ['Due date', inv.dueDate ? calendarDateString(inv.dueDate) : '–'],
    ['Phone', inv.patient.phone ? formatPhone(inv.patient.phone) : '–'],
    ['Status', STATUS_LABELS[inv.status] ?? inv.status],
    ['Visit', appt?.appointmentNumber ?? '–'],
    ...(appt
      ? ([
          ['Doctor', appt.doctor ? `Dr ${nameOf(appt.doctor)}` : '–'],
          ['Visit date', date(appt.startAt)],
        ] as [string, string][])
      : []),
  ]);
  pdf.doc.moveDown(0.4);
  rule(pdf);
  pdf.doc.moveDown(0.6);

  table(
    pdf,
    [
      { header: '#', width: 4 },
      { header: 'Description', width: 30 },
      { header: 'Qty', width: 6, align: 'right' },
      { header: 'Unit price', width: 13, align: 'right' },
      { header: 'Discount', width: 12, align: 'right' },
      { header: `${taxLabel} %`, width: 9, align: 'right' },
      { header: taxLabel, width: 11, align: 'right' },
      { header: 'Amount', width: 14, align: 'right' },
    ],
    inv.items.map((l, i) => [
      String(i + 1),
      l.description,
      String(l.quantity),
      pdf.money(l.unitPricePaise),
      l.discountPaise ? pdf.money(l.discountPaise) : '–',
      percent(l.taxRateBps),
      pdf.money(l.taxPaise),
      pdf.money(l.lineTotalPaise),
    ]),
  );

  totalsBlock(pdf, [
    ['Subtotal', pdf.money(inv.subtotalPaise)],
    ['Discount', inv.discountTotalPaise ? `-${pdf.money(inv.discountTotalPaise)}` : '–'],
    [taxLabel, pdf.money(inv.taxTotalPaise)],
    ['Total', pdf.money(inv.totalPaise), true],
  ]);
  pdf.doc.moveDown(0.3);
  paragraph(pdf, `Amount in words: ${amountInWords(inv.totalPaise)}`, { italic: true });
  pdf.doc.moveDown(0.8);

  if (payments.length > 0) {
    heading(pdf, 'Payments received');
    table(
      pdf,
      [
        { header: 'Receipt', width: 22 },
        { header: 'Date', width: 26 },
        { header: 'Method', width: 16 },
        { header: 'Reference', width: 16 },
        { header: 'Amount', width: 20, align: 'right' },
      ],
      payments.map((p) => [
        p.kind === 'refund' ? `${p.paymentNumber} (refund)` : p.paymentNumber,
        formatClinicDateTime(p.receivedAt, timezone),
        METHOD_LABELS[p.method] ?? p.method,
        maskReference(p.reference) ?? '–',
        pdf.money(p.amountPaise),
      ]),
    );
  }
  totalsBlock(pdf, [
    ['Amount paid', pdf.money(inv.amountPaidPaise)],
    ['Balance due', pdf.money(inv.status === 'void' ? 0 : inv.balancePaise), true],
  ]);
  pdf.doc.moveDown(0.6);
  if (inv.status === 'void' && inv.void?.at) {
    paragraph(pdf, `This invoice was voided on ${date(inv.void.at)}. Nothing is due.`, {
      align: 'center',
    });
    pdf.doc.moveDown(0.5);
  }
  if (settings.billing?.invoiceFooter) {
    paragraph(pdf, settings.billing.invoiceFooter, { muted: true });
    pdf.doc.moveDown(0.5);
  }
  paragraph(pdf, 'Computer-generated invoice – no signature required.', {
    muted: true,
    align: 'center',
  });
  return pdf.finish();
}

/**
 * A payment or refund receipt: receipt number and time, patient, invoice, amount (+ in words),
 * method, the reference's last four characters, who received it; refunds are labelled REFUND
 * with the payment they return.
 */
export async function buildReceiptPdf(
  payment: PaymentLike & { patient: Person & { mrn?: string } },
  invoice: InvoiceLike,
  refundOfNumber: string | null,
): Promise<Buffer> {
  const { timezone } = await getSettings();
  const refund = payment.kind === 'refund';
  const amount = Math.abs(payment.amountPaise);
  const pdf = createPdf({
    title: `${refund ? 'Refund' : 'Receipt'} ${payment.paymentNumber}`,
    subject: refund ? 'Refund receipt' : 'Payment receipt',
    unicode: true,
  });
  await clinicHeader(pdf, refund ? 'REFUND' : 'PAYMENT RECEIPT');
  detailsGrid(pdf, [
    ['Receipt number', payment.paymentNumber],
    ['Patient', nameOf(payment.patient)],
    ['Date', formatClinicDateTime(payment.receivedAt, timezone)],
    ['MRN', payment.patient?.mrn ?? '–'],
    ['Invoice', invoice.invoiceNumber ?? '–'],
    ['Method', METHOD_LABELS[payment.method] ?? payment.method],
    ['Reference', maskReference(payment.reference) ?? '–'],
    [refund ? 'Refunded by' : 'Received by', nameOf(payment.receivedBy as Person)],
    ...(refund ? ([['Refund of', refundOfNumber ?? '–']] as [string, string][]) : []),
  ]);
  pdf.doc.moveDown(0.4);
  rule(pdf);
  pdf.doc.moveDown(0.8);
  totalsBlock(pdf, [[refund ? 'Amount refunded' : 'Amount received', pdf.money(amount), true]]);
  pdf.doc.moveDown(0.3);
  paragraph(pdf, `Amount in words: ${amountInWords(amount)}`, { italic: true });
  if (refund && payment.reason) {
    pdf.doc.moveDown(0.5);
    paragraph(pdf, `Reason: ${payment.reason}`);
  }
  pdf.doc.moveDown(1);
  paragraph(pdf, 'Computer-generated receipt – no signature required.', {
    muted: true,
    align: 'center',
  });
  return pdf.finish();
}
