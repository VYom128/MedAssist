import { Plus, Receipt, Search, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import FilterChip from '../../../components/ui/FilterChip';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { linkClass } from '../../../components/ui/linkClass';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  type InvoiceStatus,
} from '../../../constants/catalog';
import { ROLES } from '../../../constants/roles';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatDate } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListInvoicesQuery, type InvoiceListItem } from '../api';
import InvoiceSummaryStrip from '../components/InvoiceSummaryStrip';
import NewInvoiceModal from '../components/NewInvoiceModal';
import { invoicesBase } from '../paths';

const PAGE_SIZE = 20;

/**
 * /reception/invoices and /admin/invoices: status chips (several), issue-date range, search by
 * invoice number or patient (all in the URL), "Needs attention" (cancelled tests billed), a
 * summary strip for the filtered set, and the list (cards on phones).
 */
export default function InvoicesListPage() {
  const user = useAppSelector(selectCurrentUser);
  const base = invoicesBase(user?.role);
  const params = useListParams();
  const [search, setSearch] = useState(params.get('q'));
  const q = useDebouncedValue(search.trim());
  const [creating, setCreating] = useState(false);
  const statuses = params
    .get('status')
    .split(',')
    .filter((s): s is InvoiceStatus => (INVOICE_STATUSES as readonly string[]).includes(s));
  const attention = params.get('attention') === '1';
  const filtered = Boolean(q || statuses.length || attention || params.hasAny('from', 'to'));

  const list = useListInvoicesQuery({
    ...(statuses.length ? { status: statuses.join(',') } : {}),
    ...(params.get('from') ? { from: params.get('from') } : {}),
    ...(params.get('to') ? { to: params.get('to') } : {}),
    ...(q ? { q } : {}),
    ...(attention ? { needsAttention: true } : {}),
    page: params.page,
    limit: PAGE_SIZE,
  });

  const toggleStatus = (s: InvoiceStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    params.update({ status: next.join(',') });
  };

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
    {
      key: 'patient',
      header: 'Patient',
      cell: (i) => (
        <span>
          <span className="block font-medium text-ink">{i.patient.name}</span>
          <span className="block text-xs text-muted">{i.patient.mrn}</span>
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      cell: (i) => formatDate(i.issuedAt ?? i.createdAt ?? ''),
    },
    {
      key: 'total',
      header: 'Total',
      cell: (i) => formatINR(i.totalPaise),
      className: 'tabular text-right',
    },
    {
      key: 'paid',
      header: 'Paid',
      cell: (i) => formatINR(i.amountPaidPaise),
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
      cell: (i) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill domain="invoice" status={i.status} size="sm" />
          {i.hasCancelledItemsBilled && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning-700">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Needs attention
            </span>
          )}
        </span>
      ),
      hideOnCard: true,
    },
  ];

  return (
    <section>
      <PageHeader
        title="Invoices"
        description="Bills for visits and other charges. Drafts are created when the doctor signs the note."
        actions={
          user?.role === ROLES.RECEPTIONIST || user?.role === ROLES.ADMIN ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New invoice
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4">
        <InvoiceSummaryStrip totals={list.data?.totals} />
        <FilterBar
          label="Filter invoices"
          onClear={
            filtered
              ? () => {
                  setSearch('');
                  params.clear();
                }
              : undefined
          }
        >
          <Input
            label="Search"
            placeholder="Invoice no., patient name, MRN or phone"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              params.update({ q: e.target.value.trim() });
            }}
            trailing={<Search className="h-4 w-4 text-muted" aria-hidden="true" />}
            className="sm:min-w-72"
          />
          <Input
            label="From"
            type="date"
            value={params.get('from')}
            onChange={(e) => params.update({ from: e.target.value })}
          />
          <Input
            label="To"
            type="date"
            value={params.get('to')}
            onChange={(e) => params.update({ to: e.target.value })}
          />
        </FilterBar>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
          {INVOICE_STATUSES.map((s) => (
            <FilterChip
              key={s}
              label={INVOICE_STATUS_LABELS[s]}
              selected={statuses.includes(s)}
              onClick={() => toggleStatus(s)}
            />
          ))}
          <FilterChip
            label="Needs attention"
            selected={attention}
            onClick={() => params.update({ attention: attention ? '' : '1' })}
          />
        </div>

        {list.isLoading && <ListSkeleton label="Loading invoices…" rows={5} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            icon={Receipt}
            title={filtered ? 'No invoices match these filters' : 'No invoices yet'}
            description={
              filtered
                ? 'Try other filters or clear them.'
                : 'Invoices appear when doctors sign visit notes.'
            }
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <Table
              caption="Invoices"
              columns={columns}
              rows={list.data.items}
              rowKey={(i) => i.id}
              cardHeader={(i) => (
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <StatusPill domain="invoice" status={i.status} size="sm" />
                  {i.hasCancelledItemsBilled && (
                    <span className="text-xs font-semibold text-warning-700">Needs attention</span>
                  )}
                </span>
              )}
            />
            <Pagination
              meta={list.data.meta}
              onPageChange={(page) => params.update({ page: String(page) })}
            />
          </>
        )}
      </div>
      {creating && <NewInvoiceModal open onClose={() => setCreating(false)} />}
    </section>
  );
}
