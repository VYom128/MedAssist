import { Plus, Search, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import PageHeader from '../../../components/PageHeader';
import Badge from '../../../components/ui/Badge';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import Switch from '../../../components/ui/Switch';
import Table, { type Column } from '../../../components/ui/Table';
import {
  GENDER_LABELS,
  GENDER_SHORT,
  GENDERS,
  optionsOf,
  type Gender,
} from '../../../constants/catalog';
import { ROLES } from '../../../constants/roles';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListPatientsQuery, type PatientListItem } from '../api';
import PortalBadge from '../components/PortalBadge';
import { ageSex, patientsBase } from '../paths';

const PAGE_SIZE = 20;
const GENDER_OPTIONS = optionsOf(GENDERS, GENDER_LABELS);
const PORTAL_OPTIONS = [
  { value: 'yes', label: 'Has portal account' },
  { value: 'no', label: 'No portal account' },
];
const AGE_OPTIONS = [
  { value: '0-17', label: 'Children (0–17)' },
  { value: '18-39', label: '18–39' },
  { value: '40-59', label: '40–59' },
  { value: '60-120', label: '60 and over' },
];

const newButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/**
 * /reception/patients and /admin/patients (spec §7.7, §12.1): search by MRN, phone or name
 * (debounced), filters in the URL. Admins also see inactive patients on request and cannot
 * register patients here.
 */
export default function PatientsPage() {
  const user = useAppSelector(selectCurrentUser);
  const isAdmin = user?.role === ROLES.ADMIN;
  const base = patientsBase(user?.role);
  const list = useListParams();
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim(), 300);

  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const gender = list.get('gender') as Gender | '';
  const age = list.get('age');
  const portal = list.get('portal');
  const inactive = isAdmin && list.get('inactive') === '1';
  const [ageMin, ageMax] = age ? age.split('-').map(Number) : [];
  const { data, isLoading, isFetching, isError, error, refetch } = useListPatientsQuery({
    page: list.page,
    limit: PAGE_SIZE,
    ...(list.get('q') ? { q: list.get('q') } : {}),
    ...(gender ? { gender } : {}),
    ...(ageMin !== undefined ? { ageMin, ageMax } : {}),
    ...(portal ? { hasPortal: portal === 'yes' } : {}),
    ...(inactive ? { isActive: false } : {}),
    sort: list.get('q') ? 'lastName' : '-createdAt',
  });
  const filtered = list.hasAny('q', 'gender', 'age', 'portal', 'inactive');

  const columns: Column<PatientListItem>[] = [
    { key: 'mrn', header: 'MRN', cell: (p) => <span className="font-mono">{p.mrn}</span> },
    {
      key: 'name',
      header: 'Name',
      cell: (p) => (
        <Link to={`${base}/${p.id}`} className="font-medium text-brand-700 hover:underline">
          {p.fullName}
        </Link>
      ),
    },
    { key: 'ageSex', header: 'Age / sex', cell: (p) => ageSex(p.age, GENDER_SHORT[p.gender]) },
    {
      key: 'phone',
      header: 'Phone',
      cell: (p) => <span className="whitespace-nowrap">{formatPhone(p.phone)}</span>,
    },
    {
      key: 'portal',
      header: 'Portal',
      cell: (p) => (
        <span className="inline-flex flex-wrap justify-end gap-1">
          <PortalBadge state={p.hasPortal ? 'linked' : 'none'} />
          {!p.isActive && <Badge tone="neutral">Inactive</Badge>}
        </span>
      ),
    },
  ];

  const clear = () => {
    setSearch('');
    list.clear();
  };

  return (
    <section className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Patients"
        description={
          isAdmin ? 'Registered patients (read-only).' : 'Search before registering a new patient.'
        }
        actions={
          !isAdmin && (
            <Link to={`${base}/new`} className={newButtonClass}>
              <Plus className="h-4 w-4" aria-hidden="true" /> New patient
            </Link>
          )
        }
      />

      <FilterBar label="Patient filters" onClear={filtered ? clear : undefined}>
        <Input
          label="Search"
          type="search"
          placeholder="MRN, phone or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          trailing={<Search className="mr-1 h-4 w-4 text-slate-400" aria-hidden="true" />}
        />
        <Select
          label="Gender"
          placeholder="Any gender"
          options={GENDER_OPTIONS}
          value={gender}
          onChange={(e) => list.update({ gender: e.target.value })}
        />
        <Select
          label="Age"
          placeholder="Any age"
          options={AGE_OPTIONS}
          value={age}
          onChange={(e) => list.update({ age: e.target.value })}
        />
        <Select
          label="Portal"
          placeholder="Any"
          options={PORTAL_OPTIONS}
          value={portal}
          onChange={(e) => list.update({ portal: e.target.value })}
        />
        {isAdmin && (
          <div className="sm:pb-2">
            <Switch
              label="Show inactive only"
              checked={inactive}
              onChange={(on) => list.update({ inactive: on ? '1' : '' })}
            />
          </div>
        )}
      </FilterBar>

      {isLoading && <ListSkeleton label="Loading patients…" />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={UserRound}
          title={filtered ? 'No patients match' : 'No patients yet'}
          description={
            filtered
              ? isAdmin
                ? 'Try another search or clear the filters.'
                : 'Check the spelling or search by phone, or register them as a new patient.'
              : isAdmin
                ? undefined
                : 'Register the first patient to get started.'
          }
          action={
            !isAdmin && (
              <Link to={`${base}/new`} className={newButtonClass}>
                <Plus className="h-4 w-4" aria-hidden="true" /> New patient
              </Link>
            )
          }
        />
      )}

      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table caption="Patients" columns={columns} rows={data.items} rowKey={(p) => p.id} />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}
    </section>
  );
}
