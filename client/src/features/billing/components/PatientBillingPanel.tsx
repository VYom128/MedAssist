import { HandCoins, Receipt, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import StatCard from '../../../components/ui/StatCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { linkClass } from '../../../components/ui/linkClass';
import { useState } from 'react';
import { formatDate } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { useListInvoicesQuery, type InvoiceListItem } from '../api';

/** A patient's invoices with the outstanding balance (reception patient page, Billing tab). */
export default function PatientBillingPanel({
  patientId,
  base,
}: {
  patientId: string;
  /** Where invoice links go ('/reception/invoices'). */
  base: string;
}) {
  const [page, setPage] = useState(1);
  const list = useListInvoicesQuery({ patient: patientId, page, limit: 10 });
  const columns: Column<InvoiceListItem>[] = [
    {
      key: 'number',
      header: 'Invoice',
      cell: (i) => (
        <Link to={`${base}/${i.id}`} className={`font-semibold ${linkClass}`}>
          {i.invoiceNumber ?? 'Draft'}
        </Link>
      ),
    },
    { key: 'date', header: 'Date', cell: (i) => formatDate(i.issuedAt ?? i.createdAt ?? '') },
    {
      key: 'total',
      header: 'Total',
      cell: (i) => formatINR(i.totalPaise),
      className: 'tabular text-right',
    },
    {
      key: 'balance',
      header: 'Balance',
      cell: (i) => formatINR(i.status === 'void' ? 0 : i.balancePaise),
      className: 'tabular text-right',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => <StatusPill domain="invoice" status={i.status} size="sm" />,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Outstanding balance"
          value={
            <span className="tabular">
              {list.data ? formatINR(list.data.totals.outstandingPaise) : '—'}
            </span>
          }
          icon={HandCoins}
          tone={list.data && list.data.totals.outstandingPaise > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Paid to date"
          value={
            <span className="tabular">
              {list.data ? formatINR(list.data.totals.collectedPaise) : '—'}
            </span>
          }
          icon={Wallet}
          tone="success"
        />
      </div>
      <SectionCard title="Invoices" icon={Receipt}>
        {list.isLoading && <ListSkeleton label="Loading invoices…" rows={3} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState icon={Receipt} title="No invoices for this patient" />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <Table
              caption="Patient invoices"
              columns={columns}
              rows={list.data.items}
              rowKey={(i) => i.id}
            />
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
