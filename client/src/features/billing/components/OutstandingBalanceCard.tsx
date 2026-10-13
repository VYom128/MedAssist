import { HandCoins } from 'lucide-react';
import StatCard from '../../../components/ui/StatCard';
import { formatINR } from '../../../utils/money';

/**
 * Patient dashboard: the outstanding balance, only when something is due (Phase 7). Phase 10
 * feeds it from /dashboard/patient.
 */
export default function OutstandingBalanceCard({
  balancePaise,
  invoices,
}: {
  balancePaise: number;
  invoices: number;
}) {
  if (balancePaise <= 0) return null;
  return (
    <StatCard
      label="Outstanding balance"
      value={<span className="tabular">{formatINR(balancePaise)}</span>}
      icon={HandCoins}
      tone="warning"
      hint={`${invoices} unpaid invoice${invoices === 1 ? '' : 's'} · please pay at the clinic reception`}
      to="/patient/invoices"
    />
  );
}
