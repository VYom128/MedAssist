import type {
  BillingRules,
  DaySummary,
  Invoice,
  InvoiceLine,
  InvoiceListItem,
  Payment,
} from '../src/features/billing/api';

/** Billing fixtures (Phase 7): amounts in paise, like the API. */

export const RULES: BillingRules = {
  taxLabel: 'GST',
  defaultTaxRateBps: 0,
  maxDiscountPercentWithoutAdmin: 10,
  paymentMethods: ['cash', 'card', 'upi', 'insurance'],
};

export function line(over: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: 'l1',
    kind: 'other',
    origin: 'staff',
    refId: null,
    labOrderId: null,
    labOrderItemId: null,
    description: 'Dressing',
    quantity: 1,
    unitPricePaise: 10_000,
    discountPaise: 0,
    taxRateBps: 0,
    grossPaise: 10_000,
    taxablePaise: 10_000,
    taxPaise: 0,
    lineTotalPaise: 10_000,
    ...over,
  };
}

export function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1',
    invoiceNumber: null,
    kind: 'manual',
    status: 'draft',
    revision: 0,
    patient: { id: 'p1', name: 'Meera Iyer', mrn: 'MRN-000007', phone: null },
    appointment: null,
    items: [line()],
    subtotalPaise: 10_000,
    discountTotalPaise: 0,
    taxTotalPaise: 0,
    totalPaise: 10_000,
    amountPaidPaise: 0,
    balancePaise: 10_000,
    discountPercent: 0,
    currency: 'INR',
    issuedAt: null,
    dueDate: null,
    void: null,
    createdAt: '2026-10-06T05:00:00Z',
    updatedAt: '2026-10-06T05:00:00Z',
    issuedBy: null,
    notes: null,
    discountApproval: null,
    cancelledItemsBilled: [],
    statusHistory: [],
    createdByName: 'Riya Desk',
    rules: RULES,
    ...over,
  };
}

export const issued = (over: Partial<Invoice> = {}) =>
  invoice({
    invoiceNumber: 'INV-2026-000042',
    status: 'issued',
    issuedAt: '2026-10-06T06:00:00Z',
    dueDate: '2026-10-06',
    totalPaise: 50_000,
    subtotalPaise: 50_000,
    balancePaise: 50_000,
    items: [
      line({
        unitPricePaise: 50_000,
        grossPaise: 50_000,
        taxablePaise: 50_000,
        lineTotalPaise: 50_000,
      }),
    ],
    ...over,
  });

export function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: 'pay1',
    paymentNumber: 'PAY-2026-000010',
    invoiceId: 'inv1',
    kind: 'payment',
    amountPaise: 30_000,
    method: 'cash',
    reference: null,
    refundOf: null,
    receivedAt: '2026-10-06T06:05:00Z',
    refundedPaise: 0,
    refundablePaise: 30_000,
    reason: null,
    receivedByName: 'Riya Desk',
    ...over,
  };
}

export function listItem(over: Partial<InvoiceListItem> = {}): InvoiceListItem {
  return {
    id: 'inv1',
    invoiceNumber: 'INV-2026-000042',
    kind: 'appointment',
    status: 'issued',
    patient: { id: 'p1', name: 'Meera Iyer', mrn: 'MRN-000007' },
    appointment: {
      id: 'a1',
      appointmentNumber: 'APT-2026-000100',
      startAt: '2026-10-06T04:30:00Z',
      doctorName: 'Anil Mehta',
    },
    lineCount: 2,
    subtotalPaise: 123_456,
    discountTotalPaise: 0,
    taxTotalPaise: 0,
    totalPaise: 123_456,
    amountPaidPaise: 23_456,
    balancePaise: 100_000,
    issuedAt: '2026-10-06T06:00:00Z',
    createdAt: '2026-10-06T05:00:00Z',
    hasCancelledItemsBilled: false,
    ...over,
  };
}

export const listMeta = (
  total: number,
  totals = { billedPaise: 0, collectedPaise: 0, outstandingPaise: 0 },
) => ({
  page: 1,
  limit: 20,
  total,
  totalPages: total ? 1 : 0,
  totals,
});

export function daySummary(over: Partial<DaySummary> = {}): DaySummary {
  return {
    date: '2026-10-06',
    timezone: 'Asia/Kolkata',
    byMethod: [
      {
        method: 'cash',
        paymentCount: 2,
        collectedPaise: 1_500_000,
        refundCount: 1,
        refundedPaise: 265_450,
        netPaise: 1_234_550,
      },
      {
        method: 'card',
        paymentCount: 0,
        collectedPaise: 0,
        refundCount: 0,
        refundedPaise: 0,
        netPaise: 0,
      },
      {
        method: 'upi',
        paymentCount: 1,
        collectedPaise: 9_999,
        refundCount: 0,
        refundedPaise: 0,
        netPaise: 9_999,
      },
      {
        method: 'insurance',
        paymentCount: 0,
        collectedPaise: 0,
        refundCount: 0,
        refundedPaise: 0,
        netPaise: 0,
      },
      {
        method: 'other',
        paymentCount: 0,
        collectedPaise: 0,
        refundCount: 0,
        refundedPaise: 0,
        netPaise: 0,
      },
    ],
    totals: {
      paymentCount: 3,
      collectedPaise: 1_509_999,
      refundCount: 1,
      refundedPaise: 265_450,
      netPaise: 1_244_549,
    },
    payments: [
      {
        id: 'pay1',
        paymentNumber: 'PAY-2026-000010',
        kind: 'payment',
        time: '09:15',
        receivedAt: '2026-10-06T03:45:00Z',
        invoiceId: 'inv1',
        invoiceNumber: 'INV-2026-000042',
        patientName: 'Meera I.',
        method: 'cash',
        amountPaise: 1_000_000,
        receivedByName: 'Riya Desk',
      },
    ],
    ...over,
  };
}
