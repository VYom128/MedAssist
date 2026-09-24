import { Search, TriangleAlert, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../../../components/ui/Avatar';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import Table, { type Column } from '../../../components/ui/Table';
import { linkClass } from '../../../components/ui/linkClass';
import { GENDER_SHORT } from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatDate } from '../../../utils/dates';
import { useListPatientsQuery, type PatientListItem } from '../../patients/api';
import { ageSex } from '../../patients/paths';

const PAGE_SIZE = 20;

/**
 * /doctor/patients – "My patients" (GET /patients?scope=mine): the patients the doctor has a care
 * relationship with, most recently seen first, with the last visit and an allergy flag.
 */
export default function MyPatientsPage() {
  const list = useListParams();
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListPatientsQuery({
    scope: 'mine',
    page: list.page,
    limit: PAGE_SIZE,
    ...(list.get('q') ? { q: list.get('q') } : {}),
  });

  const columns: Column<PatientListItem>[] = [
    {
      key: 'name',
      header: 'Patient',
      hideOnCard: true,
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={p.fullName} size="md" />
          <div className="min-w-0">
            <Link to={`/doctor/patients/${p.id}`} className={linkClass}>
              {p.fullName}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <Code>{p.mrn}</Code>
              {p.hasAllergies && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger-700">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Allergies
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'ageSex',
      header: 'Age / sex',
      cell: (p) => <span className="tabular">{ageSex(p.age, GENDER_SHORT[p.gender])}</span>,
    },
    {
      key: 'lastVisit',
      header: 'Last visit',
      cell: (p) => (
        <span className="tabular">
          {p.lastVisitAt ? formatDate(p.lastVisitAt) : 'Not seen yet'}
        </span>
      ),
    },
  ];

  return (
    <section>
      <PageHeader
        title="My patients"
        description="Patients you have seen or have an appointment with."
      />
      <FilterBar label="Search my patients">
        <Input
          label="Search"
          type="search"
          placeholder="MRN, phone or name"
          value={search}
          trailing={<Search className="mr-3 h-4 w-4 text-subtle" aria-hidden="true" />}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>
      {isLoading && <ListSkeleton label="Loading your patients…" rows={6} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={UserRound}
          title={list.get('q') ? 'No matching patients' : 'No patients yet'}
          description={
            list.get('q')
              ? 'Try another name, MRN or phone number.'
              : 'Patients appear here once they have an appointment with you.'
          }
        />
      )}
      {data && data.items.length > 0 && (
        <div className={isFetching ? 'opacity-70' : ''}>
          <Table
            caption="My patients"
            columns={columns}
            rows={data.items}
            rowKey={(p) => p.id}
            cardHeader={(p) => columns[0]!.cell(p)}
          />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}
    </section>
  );
}
