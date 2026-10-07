import { Pill } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import Tabs from '../../../components/ui/Tabs';
import { formatDate } from '../../../utils/dates';
import { useListPrescriptionsQuery, type PrescriptionListItem } from '../api';

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'past', label: 'Past' },
] as const;

const columns: Column<PrescriptionListItem>[] = [
  {
    key: 'date',
    header: 'Issued',
    cell: (p) => (
      <Link
        to={`/patient/prescriptions/${p.id}`}
        className="tabular font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {p.issuedAt ? formatDate(p.issuedAt) : (p.prescriptionNumber ?? 'Prescription')}
      </Link>
    ),
  },
  { key: 'doctor', header: 'Doctor', cell: (p) => `Dr ${p.doctor.name}` },
  {
    key: 'items',
    header: 'Medicines',
    cell: (p) => `${p.itemCount} medicine${p.itemCount === 1 ? '' : 's'}`,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (p) => <StatusPill domain="prescription" status={p.status} size="sm" />,
  },
];

/**
 * /patient/prescriptions – the patient's issued prescriptions: "Active" (still being taken) and
 * "Past" (the course is over). Drafts are never listed (the server only returns issued ones).
 */
export default function MyPrescriptionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'past' ? 'past' : 'active';
  const page = Number(params.get('page') ?? '1') || 1;
  const list = useListPrescriptionsQuery({
    status: tab === 'active' ? 'issued' : 'completed',
    page,
    limit: 20,
  });
  return (
    <section>
      <PageHeader title="My prescriptions" description="Medicines your doctors have prescribed." />
      <Tabs
        label="Prescriptions"
        tabs={TABS}
        value={tab}
        onChange={(next) => setParams({ tab: next }, { replace: true })}
      >
        <SectionCard title={tab === 'active' ? 'Active' : 'Past'} icon={Pill} iconTone="primary">
          {list.isLoading && <ListSkeleton label="Loading your prescriptions…" rows={3} />}
          {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
          {list.data && list.data.items.length === 0 && (
            <EmptyState
              icon={Pill}
              title={tab === 'active' ? 'No active prescriptions' : 'No past prescriptions'}
              description={
                tab === 'active'
                  ? 'Prescriptions appear here when your doctor issues them.'
                  : 'Prescriptions move here once the course is over.'
              }
            />
          )}
          {list.data && list.data.items.length > 0 && (
            <>
              <Table
                caption={tab === 'active' ? 'Active prescriptions' : 'Past prescriptions'}
                columns={columns}
                rows={list.data.items}
                rowKey={(p) => p.id}
              />
              <Pagination
                meta={list.data.meta}
                onPageChange={(next) => setParams({ tab, page: String(next) }, { replace: true })}
              />
            </>
          )}
        </SectionCard>
      </Tabs>
    </section>
  );
}
