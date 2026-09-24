import { CalendarDays, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterChip from '../../../components/ui/FilterChip';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { linkClass } from '../../../components/ui/linkClass';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPES,
  optionsOf,
  type AppointmentStatus,
  type AppointmentType,
} from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { clinicDate, formatDate, formatTime } from '../../../utils/dates';
import { useListDepartmentsQuery } from '../../departments/api';
import { useListDoctorsQuery } from '../../doctors/api';
import { useListAppointmentsQuery, type Appointment } from '../api';
import PriorityPill from './PriorityPill';

const PAGE_SIZE = 20;
const TYPE_OPTIONS = optionsOf(APPOINTMENT_TYPES, APPOINTMENT_TYPE_LABELS);

/**
 * Appointments as a table (cards on phones) with filters in the URL: clinic date range (default
 * from today), doctor, department, status (several), type and a search by appointment number,
 * patient name, MRN or phone.
 */
export default function AppointmentList({ base }: { base: string }) {
  const list = useListParams();
  const today = clinicDate();
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const from = list.get('from') || today;
  const to = list.get('to');
  const statuses = list.get('status').split(',').filter(Boolean) as AppointmentStatus[];
  const departments = useListDepartmentsQuery({ limit: 100 });
  const doctors = useListDoctorsQuery({
    limit: 100,
    ...(list.get('department') ? { department: list.get('department') } : {}),
  });
  const { data, isLoading, isFetching, isError, error, refetch } = useListAppointmentsQuery({
    page: list.page,
    limit: PAGE_SIZE,
    from,
    ...(to ? { to } : {}),
    ...(list.get('doctor') ? { doctor: list.get('doctor') } : {}),
    ...(list.get('department') ? { department: list.get('department') } : {}),
    ...(statuses.length ? { status: statuses.join(',') } : {}),
    ...(list.get('type') ? { type: list.get('type') as AppointmentType } : {}),
    ...(list.get('q') ? { q: list.get('q') } : {}),
  });
  const filtered = list.hasAny('from', 'to', 'doctor', 'department', 'status', 'type', 'q');

  const toggleStatus = (s: AppointmentStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    list.update({ status: next.join(',') });
  };

  const patientCell = (a: Appointment) => (
    <div className="min-w-0">
      <Link to={`${base}/${a.id}`} className={linkClass}>
        {a.patient?.fullName ?? a.appointmentNumber}
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <Code>{a.appointmentNumber}</Code>
        {a.patient && <span>{a.patient.mrn}</span>}
      </div>
    </div>
  );

  const columns: Column<Appointment>[] = [
    {
      key: 'when',
      header: 'When',
      cell: (a) => (
        <span className="tabular whitespace-nowrap">
          {formatDate(a.startAt)}
          <span className="block text-xs text-muted">{formatTime(a.startAt)}</span>
        </span>
      ),
    },
    { key: 'patient', header: 'Patient', hideOnCard: true, cell: patientCell },
    { key: 'doctor', header: 'Doctor', cell: (a) => a.doctor.name },
    {
      key: 'service',
      header: 'Service',
      cell: (a) => (
        <span>
          {a.service.name}
          <span className="block text-xs text-muted">{APPOINTMENT_TYPE_LABELS[a.type]}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => (
        <span className="inline-flex flex-wrap justify-end gap-1 md:justify-start">
          <StatusPill domain="appointment" status={a.status} />
          <PriorityPill priority={a.priority} />
        </span>
      ),
    },
    {
      key: 'token',
      header: 'Token',
      cell: (a) => <span className="tabular">{a.tokenNumber ?? '—'}</span>,
    },
  ];

  return (
    <div>
      <div
        role="search"
        aria-label="Appointment filters"
        className="mb-4 space-y-4 rounded-card border border-line bg-surface p-4 shadow-card"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search"
            type="search"
            placeholder="APT number, patient, MRN or phone"
            className="sm:col-span-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            trailing={<Search className="mr-2 h-4 w-4 text-subtle" aria-hidden="true" />}
          />
          <Input
            label="From"
            type="date"
            value={from}
            onChange={(e) => list.update({ from: e.target.value })}
          />
          <Input
            label="To"
            type="date"
            min={from}
            value={to}
            onChange={(e) => list.update({ to: e.target.value })}
          />
          <Select
            label="Department"
            placeholder="All departments"
            options={(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
            value={list.get('department')}
            onChange={(e) => list.update({ department: e.target.value, doctor: '' })}
          />
          <Select
            label="Doctor"
            placeholder="All doctors"
            options={(doctors.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
            value={list.get('doctor')}
            onChange={(e) => list.update({ doctor: e.target.value })}
          />
          <Select
            label="Type"
            placeholder="All types"
            options={TYPE_OPTIONS}
            value={list.get('type')}
            onChange={(e) => list.update({ type: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          {APPOINTMENT_STATUSES.map((s) => (
            <FilterChip
              key={s}
              label={APPOINTMENT_STATUS_LABELS[s]}
              selected={statuses.includes(s)}
              onClick={() => toggleStatus(s)}
            />
          ))}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                list.clear();
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {isLoading && <ListSkeleton label="Loading appointments…" />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title={filtered ? 'No appointments match' : 'No upcoming appointments'}
          description={
            filtered ? 'Try other dates or clear the filters.' : 'Book one with “Book appointment”.'
          }
        />
      )}
      {data && data.items.length > 0 && (
        <div
          aria-busy={isFetching || undefined}
          className={`transition-opacity duration-200 ease-standard ${isFetching ? 'opacity-60' : ''}`}
        >
          <Table
            caption="Appointments"
            columns={columns}
            rows={data.items}
            rowKey={(a) => a.id}
            cardHeader={patientCell}
          />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}
    </div>
  );
}
