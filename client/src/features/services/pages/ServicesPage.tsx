import { Plus, Receipt, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import StatusToggleButton from '../../../components/StatusToggleButton';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Pagination from '../../../components/ui/Pagination';
import Select from '../../../components/ui/Select';
import StatusBadge from '../../../components/ui/StatusBadge';
import Table, { type Column } from '../../../components/ui/Table';
import {
  optionsOf,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPES,
  type ServiceType,
} from '../../../constants/catalog';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatINR, formatPercentFromBps } from '../../../utils/money';
import { useListDepartmentsQuery } from '../../departments/api';
import { useListServicesQuery, useServiceActionMutation, type AdminService } from '../api';
import ServiceFormModal from '../components/ServiceFormModal';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/** /admin/services (spec §7.5). Prices are shown in ₹ and stored in paise. */
export default function ServicesPage() {
  const list = useListParams();
  const [editing, setEditing] = useState<AdminService | 'new' | null>(null);
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim());
  const [toggle] = useServiceActionMutation();
  const departments = useListDepartmentsQuery({ limit: 100, includeInactive: true });

  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const department = list.get('department');
  const type = list.get('type') as ServiceType | '';
  const status = list.get('status');
  const { data, isLoading, isFetching, isError, error, refetch } = useListServicesQuery({
    page: list.page,
    limit: PAGE_SIZE,
    ...(status ? { isActive: status === 'active' } : { includeInactive: true }),
    ...(department ? { department } : {}),
    ...(type ? { type } : {}),
    ...(list.get('q') ? { q: list.get('q') } : {}),
  });
  const filtered = list.hasAny('q', 'department', 'type', 'status');

  const columns: Column<AdminService>[] = [
    { key: 'code', header: 'Code', cell: (s) => <span className="font-mono">{s.code}</span> },
    { key: 'name', header: 'Name', cell: (s) => <span className="font-medium">{s.name}</span> },
    {
      key: 'department',
      header: 'Department',
      cell: (s) => s.department?.name ?? <span className="text-slate-500">Clinic-wide</span>,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (s) => <Badge tone="info">{SERVICE_TYPE_LABELS[s.type]}</Badge>,
    },
    { key: 'duration', header: 'Duration', cell: (s) => `${s.durationMinutes} min` },
    {
      key: 'price',
      header: 'Price',
      className: 'text-right whitespace-nowrap',
      cell: (s) => formatINR(s.pricePaise),
    },
    {
      key: 'tax',
      header: 'Tax',
      cell: (s) =>
        s.taxRateBps === null ? (
          <span className="text-slate-500">Default</span>
        ) : (
          formatPercentFromBps(s.taxRateBps)
        ),
    },
    { key: 'status', header: 'Status', cell: (s) => <StatusBadge active={s.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      cell: (s) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            className="!px-2 !py-1"
            onClick={() => setEditing(s)}
            aria-label={`Edit ${s.name}`}
          >
            Edit
          </Button>
          <StatusToggleButton
            size="small"
            name={s.name}
            active={s.isActive}
            onToggle={(action) => toggle({ id: s.id, action }).unwrap()}
          />
        </div>
      ),
    },
  ];

  return (
    <section className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Services"
        description="Consultations, procedures and other billable items."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add service
          </Button>
        }
      />

      <FilterBar
        onClear={
          filtered
            ? () => {
                setSearch('');
                list.clear();
              }
            : undefined
        }
      >
        <Input
          label="Search"
          type="search"
          placeholder="Name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          trailing={<Search className="mr-1 h-4 w-4 text-slate-400" aria-hidden="true" />}
        />
        <Select
          label="Department"
          placeholder="All departments"
          options={(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
          value={department}
          onChange={(e) => list.update({ department: e.target.value })}
        />
        <Select
          label="Type"
          placeholder="All types"
          options={optionsOf(SERVICE_TYPES, SERVICE_TYPE_LABELS)}
          value={type}
          onChange={(e) => list.update({ type: e.target.value })}
        />
        <Select
          label="Status"
          placeholder="Any status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => list.update({ status: e.target.value })}
        />
      </FilterBar>

      {isLoading && <ListSkeleton label="Loading services…" />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={Receipt}
          title={filtered ? 'No services match these filters' : 'No services yet'}
          description={filtered ? 'Try another search or clear the filters.' : undefined}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  list.clear();
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setEditing('new')}>Add service</Button>
            )
          }
        />
      )}
      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table caption="Services" columns={columns} rows={data.items} rowKey={(s) => s.id} />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}

      <ServiceFormModal
        open={editing !== null}
        service={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}
