import { CornerDownRight, Undo } from 'lucide-react';
import Button from '../../../components/ui/Button';
import StatusPill from '../../../components/ui/StatusPill';
import { PAYMENT_METHOD_LABELS } from '../../../constants/catalog';
import { formatDateTime } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { receiptPdfUrl, type Payment } from '../api';
import { groupPayments } from '../paths';
import PdfButton from './PdfButton';

function Line({ p, nested = false }: { p: Payment; nested?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1 ${nested ? 'pl-6' : ''}`}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          {nested && <CornerDownRight className="h-4 w-4 text-muted" aria-hidden="true" />}
          <span className="tabular">{p.paymentNumber}</span>
          <StatusPill domain="payment" status={p.kind} size="sm" />
        </p>
        <p className="text-xs text-muted">
          {formatDateTime(p.receivedAt)} · {PAYMENT_METHOD_LABELS[p.method]}
          {p.reference ? ` · Ref. ${p.reference}` : ''}
          {p.receivedByName
            ? ` · ${p.kind === 'refund' ? 'Refunded' : 'Received'} by ${p.receivedByName}`
            : ''}
        </p>
        {p.reason && <p className="mt-0.5 text-xs text-muted">Reason: {p.reason}</p>}
      </div>
      <p
        className={`tabular text-right font-semibold ${p.amountPaise < 0 ? 'text-warning-700' : 'text-ink'}`}
      >
        {p.amountPaise < 0 ? `−${formatINR(-p.amountPaise)}` : formatINR(p.amountPaise)}
      </p>
    </div>
  );
}

/**
 * Payments received, oldest first, each with its refunds nested below. `onRefund` adds a Refund
 * button to payments that still have something refundable.
 */
export default function PaymentsList({
  payments,
  onRefund,
}: {
  payments: Payment[];
  onRefund?: (p: Payment) => void;
}) {
  const groups = groupPayments(payments);
  return (
    <ul className="divide-y divide-line" aria-label="Payments">
      {groups.map(({ payment, refunds }) => (
        <li key={payment.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
          <Line p={payment} />
          {refunds.map((r) => (
            <div key={r.id} className="space-y-2">
              <Line p={r} nested />
              <div className="pl-6">
                <PdfButton
                  url={receiptPdfUrl(r.id)}
                  fileName={`${r.paymentNumber}.pdf`}
                  label="Refund receipt"
                  variant="ghost"
                />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <PdfButton
              url={receiptPdfUrl(payment.id)}
              fileName={`${payment.paymentNumber}.pdf`}
              label="Receipt"
              variant="ghost"
            />
            {onRefund && (payment.refundablePaise ?? 0) > 0 && (
              <Button size="sm" variant="ghost" onClick={() => onRefund(payment)}>
                <Undo className="h-4 w-4" aria-hidden="true" /> Refund
              </Button>
            )}
            {(payment.refundedPaise ?? 0) > 0 && (
              <span className="text-xs text-muted">
                Refunded {formatINR(payment.refundedPaise)} of {formatINR(payment.amountPaise)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
