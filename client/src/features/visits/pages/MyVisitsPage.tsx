import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import Table, { type Column } from '../../../components/ui/Table';
import { useListParams } from '../../../hooks/useListParams';
import { formatDate } from '../../../utils/dates';
import { useListMyVisitsQuery, type PatientVisitListItem } from '../api';

const columns: Column<PatientVisitListItem>[] = [
  {
    key: 'date',
    header: 'Date',
    cell: (v) => (
      <Link
        to={`/patient/visits/${v.id}`}
        className="tabular font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {formatDate(v.visitAt)}
      </Link>
    ),
  },
  { key: 'doctor', header: 'Doctor', cell: (v) => `Dr ${v.doctor.name}` },
  { key: 'department', header: 'Department', cell: (v) => v.department?.name ?? '—' },
  {
    key: 'diagnosis',
    header: 'Diagnosis',
    cell: (v) => v.primaryDiagnosis ?? <span className="text-muted">Not shared</span>,
  },
];

/** /patient/visits – the patient's signed visit summaries, newest first (Phase 8). */
export default function MyVisitsPage() {
  const params = useListParams();
  const list = useListMyVisitsQuery({ page: params.page, limit: 20 });
  return (
    <section>
      <PageHeader
        title="My visits"
        description="A summary of each visit once your doctor has finished the note."
      />
      <SectionCard title="Visits" icon={FileText} iconTone="consult">
        {list.isLoading && <ListSkeleton label="Loading your visits…" rows={3} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No visit summaries yet"
            description="A summary appears here after your doctor signs the note of a visit."
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <Table caption="Visits" columns={columns} rows={list.data.items} rowKey={(v) => v.id} />
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
