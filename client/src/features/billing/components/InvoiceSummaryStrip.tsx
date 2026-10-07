import { CircleDollarSign, HandCoins, Receipt } from 'lucide-react';
import StatCard from '../../../components/ui/StatCard';
import { formatINR } from '../../../utils/money';
import type { InvoiceListTotals } from '../api';

/** Billed, collected and outstanding for the invoices in the current filter. */
export default function InvoiceSummaryStrip({ totals }: { totals: InvoiceListTotals | undefined }) {
  const value = (paise: number | undefined) => (paise === undefined ? '—' : formatINR(paise));
  return (
    <div className="grid gap-4 sm:grid-cols-3" aria-label="Totals for these invoices">
      <StatCard
        label="Billed"
        value={<span className="tabular">{value(totals?.billedPaise)}</span>}
        icon={Receipt}
        tone="info"
        hint="Issued invoices, not void"
      />
      <StatCard
        label="Collected"
        value={<span className="tabular">{value(totals?.collectedPaise)}</span>}
        icon={CircleDollarSign}
        tone="success"
        hint="Payments less refunds"
      />
      <StatCard
        label="Outstanding"
        value={<span className="tabular">{value(totals?.outstandingPaise)}</span>}
        icon={HandCoins}
        tone="warning"
        hint="Balance still due"
      />
    </div>
  );
}
