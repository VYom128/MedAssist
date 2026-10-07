import { HandCoins, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import StatCard from '../../../components/ui/StatCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { useListInvoicesQuery, type InvoiceListItem } from '../api';

const columns: Column<InvoiceListItem>[] = [
  {
    key: 'number',
    header: 'Invoice',
    cell: (i) => (
      <Link to={`/patient/invoices/${i.id}`} className={`font-semibold ${linkClass}`}>
        {i.invoiceNumber}
      </Link>
    ),
  },
  { key: 'date', header: 'Date', cell: (i) => (i.issuedAt ? formatDate(i.issuedAt) : '—') },
  {
    key: 'visit',
    header: 'Visit',
    cell: (i) =>
      i.appointment
        ? [
            i.appointment.doctorName && `Dr ${i.appointment.doctorName}`,
            i.appointment.startAt && formatDate(i.appointment.startAt),
          ]
            .filter(Boolean)
            .join(' · ') || i.appointment.appointmentNumber
        : '—',
  },
  {
    key: 'total',
    header: 'Total',
    cell: (i) => formatINR(i.totalPaise),
    className: 'tabular text-right',
  },
  {
    key: 'balance',
    header: 'Balance',
    cell: (i) => (
      <span className="font-semibold">{formatINR(i.status === 'void' ? 0 : i.balancePaise)}</span>
    ),
    className: 'tabular text-right',
  },
  {
    key: 'status',
    header: 'Status',
    cell: (i) => <StatusPill domain="invoice" status={i.status} size="sm" />,
    hideOnCard: true,
  },
];

/**
 * /patient/invoices – the patient's issued, paid and void invoices (the server never returns
 * drafts) with the outstanding balance on top. Payment happens at the clinic reception.
 */
export default function MyInvoicesPage() {
  const [page, setPage] = useState(1);
  const list = useListInvoicesQuery({ page, limit: 20 });
  const outstanding = list.data?.totals.outstandingPaise ?? 0;
  // The server never sends drafts to patients; never show one even if it did.
  const rows = (list.data?.items ?? []).filter((i) => i.status !== 'draft');
  return (
    <section>
      <PageHeader
        title="Invoices"
        description="Your bills from the clinic and what you have paid."
      />
      <div className="space-y-4">
        {list.data && (
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Outstanding balance"
              value={<span className="tabular">{formatINR(outstanding)}</span>}
              icon={HandCoins}
              tone={outstanding > 0 ? 'warning' : 'success'}
              hint={outstanding > 0 ? 'Please pay at the clinic reception' : 'Nothing to pay'}
            />
          </div>
        )}
        {outstanding > 0 && (
          <Alert tone="info" title="Please pay at the clinic reception">
            Online payment is not available. You can pay by cash, card or UPI at the front desk.
          </Alert>
        )}
        {list.isLoading && <ListSkeleton label="Loading your invoices…" rows={4} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && rows.length === 0 && (
          <EmptyState
            icon={Receipt}
            title="No invoices yet"
            description="Invoices from your visits appear here once the clinic issues them."
          />
        )}
        {list.data && rows.length > 0 && (
          <>
            <Table
              caption="Your invoices"
              columns={columns}
              rows={rows}
              rowKey={(i) => i.id}
              cardHeader={(i) => <StatusPill domain="invoice" status={i.status} size="sm" />}
            />
            <Pagination meta={list.data.meta} onPageChange={setPage} />
          </>
        )}
      </div>
    </section>
  );
}
