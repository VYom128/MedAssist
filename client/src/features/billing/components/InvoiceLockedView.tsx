import { HandCoins, ListOrdered, Wallet } from 'lucide-react';
import { useState } from 'react';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import SectionCard from '../../../components/ui/SectionCard';
import { useAppSelector } from '../../../app/hooks';
import { amountInWords } from '../../../utils/amountInWords';
import { formatINR } from '../../../utils/money';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListInvoicePaymentsQuery, type Invoice, type Payment } from '../api';
import { invoiceActions } from '../paths';
import CancelledItemsPanel from './CancelledItemsPanel';
import InvoiceTotals from './InvoiceTotals';
import LinesTable from './LinesTable';
import PaymentsList from './PaymentsList';
import RecordPaymentModal from './RecordPaymentModal';
import RefundModal from './RefundModal';

/**
 * An issued (paid, part-paid or void) invoice: lines, totals with the amount in words, the
 * balance due in large text, payments with nested refunds, and – for the desk – Record payment
 * and Refund. Void and the PDF sit in the page header.
 */
export default function InvoiceLockedView({ invoice }: { invoice: Invoice }) {
  const user = useAppSelector(selectCurrentUser);
  const can = invoiceActions(user?.role, invoice);
  const payments = useListInvoicePaymentsQuery(invoice.id);
  const [paying, setPaying] = useState(0); // a new key per opening
  const [refunding, setRefunding] = useState<{ payment: Payment; n: number } | null>(null);
  const [n, setN] = useState(0);
  const taxLabel = invoice.rules?.taxLabel ?? 'Tax';
  const isVoid = invoice.status === 'void';
  const cancelled = invoice.cancelledItemsBilled ?? [];
  const cancelledTotal = cancelled.reduce((sum, c) => sum + c.lineTotalPaise, 0);

  return (
    <div className="space-y-6">
      {cancelled.length > 0 && <CancelledItemsPanel items={cancelled} canRefund={can.refund} />}

      <section
        aria-label="Balance due"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-sm text-muted">{isVoid ? 'Nothing is due (void)' : 'Balance due'}</p>
          <p className="tabular text-stat text-ink" data-testid="balance-due">
            {formatINR(isVoid ? 0 : invoice.balancePaise)}
          </p>
          <p className="text-sm text-muted">
            Paid {formatINR(invoice.amountPaidPaise)} of {formatINR(invoice.totalPaise)}
          </p>
        </div>
        {can.pay && (
          <Button onClick={() => setPaying((k) => k + 1)}>
            <HandCoins className="h-4 w-4" aria-hidden="true" /> Record payment
          </Button>
        )}
      </section>

      <SectionCard title="Lines" icon={ListOrdered}>
        <div className="space-y-4">
          <LinesTable lines={invoice.items} taxLabel={taxLabel} />
          <InvoiceTotals {...invoice} taxLabel={taxLabel} />
          <p className="text-right text-sm text-muted italic">
            {amountInWords(invoice.totalPaise)}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Payments" icon={Wallet}>
        {payments.isLoading && <ListSkeleton label="Loading payments…" rows={2} />}
        {payments.isError && (
          <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
        )}
        {payments.data && payments.data.length === 0 && (
          <EmptyState icon={Wallet} title="No payments yet" />
        )}
        {payments.data && payments.data.length > 0 && (
          <PaymentsList
            payments={payments.data}
            onRefund={
              can.refund
                ? (p) => {
                    setN((x) => x + 1);
                    setRefunding({ payment: p, n: n + 1 });
                  }
                : undefined
            }
          />
        )}
      </SectionCard>

      {paying > 0 && (
        <RecordPaymentModal key={paying} invoice={invoice} open onClose={() => setPaying(0)} />
      )}
      {refunding && (
        <RefundModal
          key={refunding.n}
          payment={refunding.payment}
          suggestedPaise={cancelledTotal || undefined}
          open
          onClose={() => setRefunding(null)}
        />
      )}
    </div>
  );
}
