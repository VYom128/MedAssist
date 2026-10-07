import { apiSlice } from '../../app/apiSlice';
import type { InvoiceLineKind, InvoiceStatus, PaymentMethod } from '../../constants/catalog';
import { toPaged, type ApiSuccess, type PageMeta, type Paged } from '../../utils/http';

/** Server shapes from server/src/modules/invoices and payments (spec §6.21–6.22, §7.15). */

export interface InvoiceLine {
  id: string;
  kind: InvoiceLineKind;
  /** visit = from the appointment or a lab order (only the discount can change). */
  origin: 'visit' | 'staff';
  refId: string | null;
  labOrderId: string | null;
  labOrderItemId: string | null;
  description: string;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxRateBps: number;
  grossPaise: number;
  taxablePaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

export interface InvoiceAmounts {
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  balancePaise: number;
}

export interface InvoiceRef {
  id: string;
  appointmentNumber: string | null;
  startAt: string | null;
  doctorName: string | null;
}

export interface BillingRules {
  taxLabel: string;
  defaultTaxRateBps: number;
  maxDiscountPercentWithoutAdmin: number;
  paymentMethods: PaymentMethod[];
}

export interface CancelledItemBilled {
  lineId: string | null;
  description: string;
  lineTotalPaise: number;
  labOrderId: string;
  itemId: string;
  at: string;
}

export interface Invoice extends InvoiceAmounts {
  id: string;
  invoiceNumber: string | null;
  kind: 'appointment' | 'supplementary' | 'manual';
  status: InvoiceStatus;
  /** `__v`: send it back as `expectedVersion`. */
  revision: number;
  patient: { id: string; name: string | null; mrn: string | null; phone?: string | null };
  appointment: InvoiceRef | null;
  items: InvoiceLine[];
  discountPercent: number;
  currency: string;
  issuedAt: string | null;
  dueDate: string | null;
  void: { at: string; reason: string | null; byName?: string | null } | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Staff only. */
  issuedBy?: { id: string; name: string | null } | null;
  notes?: string | null;
  discountApproval?: { at: string; byName: string | null } | null;
  cancelledItemsBilled?: CancelledItemBilled[];
  statusHistory?: { status: InvoiceStatus; at: string; by: string | null; note: string | null }[];
  createdByName?: string | null;
  rules?: BillingRules;
}

export interface InvoiceListItem extends InvoiceAmounts {
  id: string;
  invoiceNumber: string | null;
  kind: Invoice['kind'];
  status: InvoiceStatus;
  patient: { id: string; name: string | null; mrn: string | null };
  appointment: InvoiceRef | null;
  lineCount: number;
  issuedAt: string | null;
  createdAt: string | null;
  hasCancelledItemsBilled: boolean;
}

export interface InvoiceListTotals {
  billedPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
}

export interface InvoicePage extends Paged<InvoiceListItem> {
  totals: InvoiceListTotals;
}

export interface InvoiceListParams {
  status?: string;
  patient?: string;
  appointment?: string;
  from?: string;
  to?: string;
  q?: string;
  needsAttention?: boolean;
  page?: number;
  limit?: number;
}

/** A line as sent to the server (amounts are always computed there). */
export interface LineInput {
  id?: string;
  kind?: 'consultation' | 'procedure' | 'lab_test' | 'other';
  serviceId?: string;
  labTestId?: string;
  description?: string;
  quantity?: number;
  unitPricePaise?: number;
  discountPaise?: number;
  taxRateBps?: number;
}

export interface InvoiceUpdate {
  expectedVersion: number;
  items?: LineInput[];
  notes?: string | null;
  dueDate?: string | null;
}

export interface Payment {
  id: string;
  paymentNumber: string;
  invoiceId: string;
  kind: 'payment' | 'refund';
  /** Negative for refunds. */
  amountPaise: number;
  method: PaymentMethod;
  /** Patients get only the last four characters. */
  reference: string | null;
  refundOf: string | null;
  receivedAt: string;
  /** Payments only. */
  refundedPaise?: number;
  refundablePaise?: number;
  /** Staff only. */
  reason?: string | null;
  receivedByName?: string | null;
}

export interface MethodTotals {
  method: PaymentMethod;
  paymentCount: number;
  collectedPaise: number;
  refundCount: number;
  refundedPaise: number;
  netPaise: number;
}

export interface DaySummary {
  date: string;
  timezone: string;
  byMethod: MethodTotals[];
  totals: Omit<MethodTotals, 'method'>;
  payments: {
    id: string;
    paymentNumber: string;
    kind: 'payment' | 'refund';
    time: string;
    receivedAt: string;
    invoiceId: string;
    invoiceNumber: string | null;
    patientName: string | null;
    method: PaymentMethod;
    amountPaise: number;
    receivedByName: string | null;
  }[];
}

const LIST = { type: 'InvoiceList' as const, id: 'LIST' };
const invoiceTags = (id: string) => [
  { type: 'Invoice' as const, id },
  { type: 'Payment' as const, id },
  LIST,
  { type: 'PaymentSummary' as const, id: 'DAY' },
];

/** Invoices and payments (spec §7.15). PDFs are fetched as blobs (see usePdf). */
export const billingApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listInvoices: build.query<InvoicePage, InvoiceListParams>({
      query: (params) => ({ url: '/invoices', params }),
      transformResponse: (res: ApiSuccess<InvoiceListItem[]>) => {
        const meta = res.meta as unknown as PageMeta & { totals: InvoiceListTotals };
        return { ...toPaged(res), totals: meta.totals };
      },
      providesTags: (result) => [
        LIST,
        ...(result?.items.map((i) => ({ type: 'Invoice' as const, id: i.id })) ?? []),
      ],
    }),
    getInvoice: build.query<Invoice, string>({
      query: (id) => ({ url: `/invoices/${id}` }),
      transformResponse: (res: ApiSuccess<Invoice>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Invoice', id }],
    }),
    createInvoice: build.mutation<
      Invoice,
      { patientId: string; appointmentId?: string; items?: LineInput[] }
    >({
      query: (data) => ({ url: '/invoices', method: 'POST', data }),
      transformResponse: (res: ApiSuccess<Invoice>) => res.data,
      invalidatesTags: [LIST],
    }),
    updateInvoice: build.mutation<Invoice, { id: string } & InvoiceUpdate>({
      query: ({ id, ...data }) => ({ url: `/invoices/${id}`, method: 'PATCH', data }),
      transformResponse: (res: ApiSuccess<Invoice>) => res.data,
      // The response is the new truth: write it into the cache instead of refetching.
      async onQueryStarted({ id }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(billingApi.util.upsertQueryData('getInvoice', id, data));
        } catch {
          // Errors are handled by the caller.
        }
      },
      invalidatesTags: [LIST],
    }),
    issueInvoice: build.mutation<Invoice, { id: string; expectedVersion: number }>({
      query: ({ id, expectedVersion }) => ({
        url: `/invoices/${id}/issue`,
        method: 'POST',
        data: { expectedVersion },
      }),
      transformResponse: (res: ApiSuccess<Invoice>) => res.data,
      invalidatesTags: (_r, _e, { id }) => invoiceTags(id),
    }),
    voidInvoice: build.mutation<Invoice, { id: string; reason: string }>({
      query: ({ id, reason }) => ({
        url: `/invoices/${id}/void`,
        method: 'POST',
        data: { reason },
      }),
      transformResponse: (res: ApiSuccess<Invoice>) => res.data,
      invalidatesTags: (_r, _e, { id }) => invoiceTags(id),
    }),
    listInvoicePayments: build.query<Payment[], string>({
      query: (id) => ({ url: `/invoices/${id}/payments` }),
      transformResponse: (res: ApiSuccess<Payment[]>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Payment', id }],
    }),
    recordPayment: build.mutation<
      { payment: Payment; invoice: Invoice },
      { invoiceId: string; amountPaise: number; method: PaymentMethod; reference?: string }
    >({
      query: ({ invoiceId, ...data }) => ({
        url: `/invoices/${invoiceId}/payments`,
        method: 'POST',
        data,
      }),
      transformResponse: (res: ApiSuccess<{ payment: Payment; invoice: Invoice }>) => res.data,
      // A conflict or a balance error also means the invoice changed: refresh it either way.
      invalidatesTags: (_r, _e, { invoiceId }) => invoiceTags(invoiceId),
    }),
    refundPayment: build.mutation<
      { refund: Payment; invoice: Invoice },
      { paymentId: string; invoiceId: string; amountPaise: number; reason: string }
    >({
      query: ({ paymentId, amountPaise, reason }) => ({
        url: `/payments/${paymentId}/refund`,
        method: 'POST',
        data: { amountPaise, reason },
      }),
      transformResponse: (res: ApiSuccess<{ refund: Payment; invoice: Invoice }>) => res.data,
      invalidatesTags: (_r, _e, { invoiceId }) => invoiceTags(invoiceId),
    }),
    getDaySummary: build.query<DaySummary, string | undefined>({
      query: (date) => ({ url: '/payments/summary', params: date ? { date } : {} }),
      transformResponse: (res: ApiSuccess<DaySummary>) => res.data,
      providesTags: [{ type: 'PaymentSummary', id: 'DAY' }],
    }),
  }),
});

export const {
  useListInvoicesQuery,
  useLazyListInvoicesQuery,
  useGetInvoiceQuery,
  useLazyGetInvoiceQuery,
  useCreateInvoiceMutation,
  useUpdateInvoiceMutation,
  useIssueInvoiceMutation,
  useVoidInvoiceMutation,
  useListInvoicePaymentsQuery,
  useRecordPaymentMutation,
  useRefundPaymentMutation,
  useGetDaySummaryQuery,
} = billingApi;

/** Where the PDFs are (protected: fetched with the token, never linked directly). */
export const invoicePdfUrl = (id: string) => `/invoices/${id}/pdf?download=true`;
export const receiptPdfUrl = (paymentId: string) =>
  `/payments/${paymentId}/receipt.pdf?download=true`;
