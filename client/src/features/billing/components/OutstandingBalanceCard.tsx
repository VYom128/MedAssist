import { HandCoins } from 'lucide-react';
import StatCard from '../../../components/ui/StatCard';
import { formatINR } from '../../../utils/money';
import { useListInvoicesQuery } from '../api';

/** Patient dashboard: the outstanding balance, only when something is due. */
export default function OutstandingBalanceCard() {
  const { data } = useListInvoicesQuery({ limit: 1 });
  const due = data?.totals.outstandingPaise ?? 0;
  if (due <= 0) return null;
  return (
    <StatCard
      label="Outstanding balance"
      value={<span className="tabular">{formatINR(due)}</span>}
      icon={HandCoins}
      tone="warning"
      hint="Please pay at the clinic reception"
      to="/patient/invoices"
    />
  );
}
