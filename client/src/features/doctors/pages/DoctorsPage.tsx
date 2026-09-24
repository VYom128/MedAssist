import { Plus, Search, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import StatusBadge from '../../../components/ui/StatusBadge';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatINR } from '../../../utils/money';
import { useListDepartmentsQuery } from '../../departments/api';
import { useListDoctorsQuery, type Doctor } from '../api';
import AddDoctorModal from '../components/AddDoctorModal';

const PAGE_SIZE = 20;
const ACCEPTING_OPTIONS = [
  { value: 'yes', label: 'Accepting' },
  { value: 'no', label: 'Not accepting' },
];

const doctorCell = (d: Doctor) => (
  <div className="flex min-w-0 items-center gap-3">
    <Avatar name={d.name} size="md" />
    <div className="min-w-0">
      <Link
        to={`/admin/doctors/${d.id}`}
        className="rounded font-semibold text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        Dr {d.name}
      </Link>
      <p className="text-muted">{d.specialization}</p>
    </div>
  </div>
);

const columns: Column<Doctor>[] = [
  { key: 'name', header: 'Doctor', hideOnCard: true, cell: doctorCell },
  { key: 'department', header: 'Department', cell: (d) => d.department?.name ?? '—' },
  {
    key: 'fee',
    header: 'Fee',
    className: 'whitespace-nowrap',
    cell: (d) => (
      <span className="tabular">
        {d.consultationFeePaise === null ? '—' : formatINR(d.consultationFeePaise)}
      </span>
    ),
  },
  {
    key: 'accepting',
    header: 'Bookings',
    cell: (d) => (
      <StatusPill domain="booking" status={d.isAcceptingAppointments ? 'accepting' : 'paused'} />
    ),
  },
  { key: 'status', header: 'Account', cell: (d) => <StatusBadge active={d.isActive !== false} /> },
];

/** /admin/doctors – doctors with their department, fee and booking status. */
export default function DoctorsPage() {
  const list = useListParams();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim());
  const departments = useListDepartmentsQuery({ limit: 100, includeInactive: true });

  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const department = list.get('department');
  const accepting = list.get('accepting');
  const { data, isLoading, isFetching, isError, error, refetch } = useListDoctorsQuery({
    page: list.page,
    limit: PAGE_SIZE,
    includeInactive: true,
    ...(department ? { department } : {}),
    ...(accepting ? { accepting: accepting === 'yes' } : {}),
    ...(list.get('q') ? { q: list.get('q') } : {}),
  });
  const filtered = list.hasAny('q', 'department', 'accepting');
  const clear = () => {
    setSearch('');
    list.clear();
  };

  return (
    <section>
      <PageHeader
        title="Doctors"
        description="Doctor profiles, weekly schedules and leave."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add doctor
          </Button>
        }
      />
      <FilterBar onClear={filtered ? clear : undefined}>
        <Input
          label="Search"
          type="search"
          placeholder="Doctor name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          trailing={<Search className="mr-2 h-4 w-4 text-subtle" aria-hidden="true" />}
        />
        <Select
          label="Department"
          placeholder="All departments"
          options={(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
          value={department}
          onChange={(e) => list.update({ department: e.target.value })}
        />
        <Select
          label="Bookings"
          placeholder="Any"
          options={ACCEPTING_OPTIONS}
          value={accepting}
          onChange={(e) => list.update({ accepting: e.target.value })}
        />
      </FilterBar>

      {isLoading && <ListSkeleton label="Loading doctors…" />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={Stethoscope}
          title={filtered ? 'No doctors match these filters' : 'No doctors yet'}
          action={
            filtered ? (
              <Button variant="secondary" onClick={clear}>
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setAdding(true)}>Add doctor</Button>
            )
          }
        />
      )}
      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table
            caption="Doctors"
            columns={columns}
            rows={data.items}
            rowKey={(d) => d.id}
            cardHeader={doctorCell}
          />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}
      <AddDoctorModal open={adding} onClose={() => setAdding(false)} />
    </section>
  );
}
