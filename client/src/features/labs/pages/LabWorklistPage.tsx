import { FlaskConical, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import Tabs from '../../../components/ui/Tabs';
import { GENDER_SHORT } from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatDateTime } from '../../../utils/dates';
import { useListLabOrdersQuery, type LabOrderListItem } from '../api';
import { OverdueBadge, UrgentPill } from '../components/LabBadges';
import { tabParams, WORKLIST_TABS, type WorklistTab } from '../format';

const PAGE_SIZE = 20;

/** How many orders a tab holds (one small request per tab; refreshed with the worklist). */
function useTabCount(tab: WorklistTab, q: string) {
  const { data } = useListLabOrdersQuery({ ...tabParams(tab, q), limit: 1 });
  return data?.meta.total;
}

/** Counts for every tab (the same seven tabs every render, so hook order is stable). */
function useTabCounts(q: string): Record<WorklistTab, number | undefined> {
  return {
    collect: useTabCount('collect', q),
    collected: useTabCount('collected', q),
    processing: useTabCount('processing', q),
    verify: useTabCount('verify', q),
    verified: useTabCount('verified', q),
    released: useTabCount('released', q),
    rejected: useTabCount('rejected', q),
  };
}

const columns: Column<LabOrderListItem>[] = [
  {
    key: 'order',
    header: 'Order',
    cell: (o) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <Link
          to={`/lab/orders/${o.id}`}
          className="font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {o.orderNumber}
        </Link>
        <UrgentPill priority={o.priority} />
        <OverdueBadge at={o.tatBreachedAt} />
      </span>
    ),
  },
  {
    key: 'patient',
    header: 'Patient',
    cell: (o) => (
      <span>
        <span className="block font-medium text-ink">{o.patient.fullName}</span>
        <span className="block text-xs text-muted">
          {o.patient.mrn}
          {o.patient.age !== undefined ? ` · ${o.patient.age} y` : ''}
          {o.patient.gender ? ` · ${GENDER_SHORT[o.patient.gender]}` : ''}
        </span>
      </span>
    ),
  },
  {
    key: 'tests',
    header: 'Tests',
    cell: (o) =>
      o.tests
        .filter((t) => t.status !== 'cancelled')
        .map((t) => t.code)
        .join(', '),
  },
  { key: 'sample', header: 'Sample', cell: (o) => o.sampleId ?? '—', className: 'tabular' },
  {
    key: 'ordered',
    header: 'Ordered',
    cell: (o) => (o.orderedAt ? formatDateTime(o.orderedAt) : '—'),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (o) => <StatusPill domain="labOrder" status={o.status} size="sm" />,
    hideOnCard: true,
  },
];

/**
 * /lab/worklist (spec §13.4 #6): a tab per status with counts, urgent orders first (the server
 * sorts urgent, then oldest), overdue badges, search by order number, sample id, patient name or
 * MRN. Updates live (`lab.worklist.updated`). Tab, search and page live in the URL.
 */
export default function LabWorklistPage() {
  const params = useListParams();
  const tab = (WORKLIST_TABS.find((t) => t.id === params.get('tab'))?.id ??
    'collect') as WorklistTab;
  const [search, setSearch] = useState(params.get('q'));
  const q = useDebouncedValue(search.trim());
  const counts = useTabCounts(q);
  const list = useListLabOrdersQuery({
    ...tabParams(tab, q),
    page: params.page,
    limit: PAGE_SIZE,
  });

  return (
    <section>
      <PageHeader
        title="Lab worklist"
        description="Collect samples, enter results, verify and release. Urgent orders come first."
      />
      <div className="space-y-4">
        <FilterBar label="Search the worklist" onClear={search ? () => setSearch('') : undefined}>
          <Input
            label="Search"
            placeholder="Order no., sample ID, patient name or MRN"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              params.update({ q: e.target.value.trim() });
            }}
            trailing={<Search className="h-4 w-4 text-muted" aria-hidden="true" />}
            className="sm:min-w-80"
          />
        </FilterBar>
        <SectionCard title="Orders" icon={FlaskConical} iconTone="info">
          <Tabs
            label="Worklist by status"
            tabs={WORKLIST_TABS.map((t) => ({
              id: t.id,
              label: counts[t.id] === undefined ? t.label : `${t.label} (${counts[t.id]})`,
            }))}
            value={tab}
            onChange={(next) => params.update({ tab: next === 'collect' ? '' : next })}
          >
            <div className="pt-4">
              {list.isLoading && <ListSkeleton label="Loading the worklist…" rows={5} />}
              {list.isError && (
                <ErrorState error={list.error} onRetry={() => void list.refetch()} />
              )}
              {list.data && list.data.items.length === 0 && (
                <EmptyState
                  icon={FlaskConical}
                  title={q ? 'No orders match your search' : 'Nothing here right now'}
                  description={
                    q
                      ? 'Try another order number, sample ID or name.'
                      : 'New orders appear here as they arrive.'
                  }
                />
              )}
              {list.data && list.data.items.length > 0 && (
                <>
                  <Table
                    caption="Lab orders"
                    columns={columns}
                    rows={list.data.items}
                    rowKey={(o) => o.id}
                    cardHeader={(o) => (
                      <span className="flex items-center justify-between gap-2">
                        <StatusPill domain="labOrder" status={o.status} size="sm" />
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
          </Tabs>
        </SectionCard>
      </div>
    </section>
  );
}
