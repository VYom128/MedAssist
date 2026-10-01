import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import Table, { type Column } from '../../../components/ui/Table';
import { useListParams } from '../../../hooks/useListParams';
import { formatDate } from '../../../utils/dates';
import { useListLabOrdersQuery, type LabOrderListItem } from '../api';

const columns: Column<LabOrderListItem>[] = [
  {
    key: 'date',
    header: 'Date',
    cell: (o) => (
      <Link
        to={`/patient/lab-reports/${o.id}`}
        className="font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {formatDate(o.releasedAt ?? o.orderedAt)}
      </Link>
    ),
  },
  {
    key: 'tests',
    header: 'Tests',
    cell: (o) => (
      <span className="flex flex-wrap items-center gap-1.5">
        {o.tests.map((t) => t.name).join(', ')}
        {o.corrected && <Badge tone="info">Corrected</Badge>}
      </span>
    ),
  },
  { key: 'doctor', header: 'Ordered by', cell: (o) => `Dr ${o.orderedBy.name}` },
];

/**
 * /patient/lab-reports – the patient's released lab reports (spec §13.1): date, tests, ordering
 * doctor, and "Corrected" when results were revised. Nothing unreleased is ever listed.
 */
export default function MyLabReportsPage() {
  const params = useListParams();
  const list = useListLabOrdersQuery({ page: params.page, limit: 20 });
  return (
    <section>
      <PageHeader
        title="Lab reports"
        description="Your lab results once the lab has checked and released them."
      />
      <SectionCard title="Reports" icon={FileText} iconTone="info">
        {list.isLoading && <ListSkeleton label="Loading your reports…" rows={3} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No lab reports yet"
            description="Reports appear here when your results are released."
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <Table
              caption="Lab reports"
              columns={columns}
              rows={list.data.items}
              rowKey={(o) => o.id}
            />
            <Pagination
              meta={list.data.meta}
              onPageChange={(page) => params.update({ page: String(page) })}
            />
          </>
        )}
      </SectionCard>
    </section>
  );
}
