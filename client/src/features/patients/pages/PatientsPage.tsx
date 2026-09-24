import { Plus, Search, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Avatar from '../../../components/ui/Avatar';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterChip from '../../../components/ui/FilterChip';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import StatusPill from '../../../components/ui/StatusPill';
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
import { useMediaQuery } from '../../../layouts/useSidebarCollapsed';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListPatientsQuery, type PatientListItem } from '../api';
import PortalBadge from '../components/PortalBadge';
import { ageSex, patientsBase } from '../paths';
import { linkClass } from '../../../components/ui/linkClass';

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

const newButtonClass = buttonClass();
const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

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
  // Filters: a collapsible panel on larger screens, a bottom sheet on phones.
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const patientCell = (p: PatientListItem) => (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={p.fullName} size="md" />
      <div className="min-w-0">
        <Link to={`${base}/${p.id}`} className={linkClass}>
          {p.fullName}
        </Link>
        <div className="mt-0.5">
          <Code>{p.mrn}</Code>
        </div>
      </div>
    </div>
  );

  const columns: Column<PatientListItem>[] = [
    { key: 'name', header: 'Patient', hideOnCard: true, cell: patientCell },
    {
      key: 'ageSex',
      header: 'Age / sex',
      cell: (p) => <span className="tabular">{ageSex(p.age, GENDER_SHORT[p.gender])}</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (p) => <span className="tabular whitespace-nowrap">{formatPhone(p.phone)}</span>,
    },
    {
      key: 'portal',
      header: 'Portal',
      cell: (p) => (
        <span className="inline-flex flex-wrap justify-end gap-1 md:justify-start">
          <PortalBadge state={p.hasPortal ? 'linked' : 'none'} />
          {!p.isActive && <StatusPill domain="record" status="inactive" />}
        </span>
      ),
    },
  ];

  const clear = () => {
    setSearch('');
    list.clear();
  };

  // Chips for the filters in the URL (the search box shows the text itself).
  const active = [
    gender && { key: 'gender', label: GENDER_LABELS[gender] },
    age && { key: 'age', label: labelOf(AGE_OPTIONS, age) },
    portal && { key: 'portal', label: labelOf(PORTAL_OPTIONS, portal) },
    inactive && { key: 'inactive', label: 'Inactive only' },
  ].filter(Boolean) as { key: string; label: string }[];

  const filterControls = (
    <div className="grid gap-4 sm:grid-cols-3">
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
        <div className="sm:col-span-3">
          <FilterChip
            label="Show inactive only"
            selected={inactive}
            onClick={() => list.update({ inactive: inactive ? '' : '1' })}
          />
        </div>
      )}
    </div>
  );

  return (
    <section>
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

      <div
        role="search"
        aria-label="Patient filters"
        className="mb-4 rounded-card border border-line bg-surface p-4 shadow-card"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Input
            label="Search"
            type="search"
            placeholder="MRN, phone or name"
            className="flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            trailing={<Search className="mr-2 h-4 w-4 text-subtle" aria-hidden="true" />}
          />
          <Button
            variant="secondary"
            aria-expanded={isPhone ? sheetOpen : panelOpen}
            aria-controls={isPhone ? undefined : 'patient-filter-panel'}
            onClick={() => (isPhone ? setSheetOpen(true) : setPanelOpen((o) => !o))}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
            {active.length > 0 && (
              <span className="tabular rounded-full bg-primary-600 px-1.5 text-xs text-white">
                {active.length}
              </span>
            )}
          </Button>
        </div>
        {!isPhone && panelOpen && (
          <div
            id="patient-filter-panel"
            className="mt-4 border-t border-line pt-4 motion-safe:animate-fade-in"
          >
            {filterControls}
          </div>
        )}
        {(active.length > 0 || filtered) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {active.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => list.update({ [f.key]: '' })}
                className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary-50 md:min-h-8 py-1 pr-2 pl-3 text-sm font-medium text-primary-700 ring-1 ring-primary-100 transition-colors ring-inset hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-safe:animate-fade-in"
              >
                {f.label}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">(remove filter)</span>
              </button>
            ))}
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {isPhone && (
        <Modal
          open={sheetOpen}
          title="Filter patients"
          onClose={() => setSheetOpen(false)}
          footer={<Button onClick={() => setSheetOpen(false)}>Show results</Button>}
        >
          {filterControls}
        </Modal>
      )}

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
        <div
          aria-busy={isFetching || undefined}
          className={`transition-opacity duration-200 ease-standard ${isFetching ? 'opacity-60' : ''}`}
        >
          <Table
            caption="Patients"
            columns={columns}
            rows={data.items}
            rowKey={(p) => p.id}
            cardHeader={patientCell}
          />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}
    </section>
  );
}
