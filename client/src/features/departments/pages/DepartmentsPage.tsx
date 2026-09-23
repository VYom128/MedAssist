import { Building2, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import StatusToggleButton from '../../../components/StatusToggleButton';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterBar from '../../../components/ui/FilterBar';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Pagination from '../../../components/ui/Pagination';
import StatusBadge from '../../../components/ui/StatusBadge';
import Switch from '../../../components/ui/Switch';
import Table, { type Column } from '../../../components/ui/Table';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { useDepartmentActionMutation, useListDepartmentsQuery, type AdminDepartment } from '../api';
import DepartmentFormModal from '../components/DepartmentFormModal';

const PAGE_SIZE = 20;

/** /admin/departments (spec §7.5). */
export default function DepartmentsPage() {
  const list = useListParams();
  const [editing, setEditing] = useState<AdminDepartment | 'new' | null>(null);
  const [search, setSearch] = useState(list.get('q'));
  const debounced = useDebouncedValue(search.trim());
  const [toggle] = useDepartmentActionMutation();

  useEffect(() => {
    if (list.get('q') !== debounced) list.update({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debounced]);

  const showInactive = list.get('inactive') === '1';
  const { data, isLoading, isFetching, isError, error, refetch } = useListDepartmentsQuery({
    page: list.page,
    limit: PAGE_SIZE,
    includeInactive: showInactive,
    ...(list.get('q') ? { q: list.get('q') } : {}),
  });
  const filtered = list.hasAny('q');

  const columns: Column<AdminDepartment>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (d) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{d.name}</p>
          {d.description && <p className="text-slate-500">{d.description}</p>}
        </div>
      ),
    },
    { key: 'code', header: 'Code', cell: (d) => <span className="font-mono">{d.code}</span> },
    { key: 'doctors', header: 'Doctors', cell: (d) => d.activeDoctors },
    { key: 'status', header: 'Status', cell: (d) => <StatusBadge active={d.isActive} /> },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      cell: (d) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            className="!px-2 !py-1"
            onClick={() => setEditing(d)}
            aria-label={`Edit ${d.name}`}
          >
            Edit
          </Button>
          <StatusToggleButton
            size="small"
            name={d.name}
            active={d.isActive}
            deactivateWarning="Patients will no longer see it. Its services stay but are hidden from booking."
            onToggle={(action) => toggle({ id: d.id, action }).unwrap()}
          />
        </div>
      ),
    },
  ];

  return (
    <section className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Departments"
        description="Clinic departments that doctors and services belong to."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add department
          </Button>
        }
      />

      <FilterBar
        onClear={
          filtered || showInactive
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
        <div className="flex items-end pb-2">
          <Switch
            label="Show inactive"
            checked={showInactive}
            onChange={(on) => list.update({ inactive: on ? '1' : '' })}
          />
        </div>
      </FilterBar>

      {isLoading && <ListSkeleton label="Loading departments…" />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={Building2}
          title={filtered ? 'No departments match your search' : 'No departments yet'}
          description={
            filtered
              ? undefined
              : 'Add the first department to start setting up doctors and services.'
          }
          action={
            filtered ? undefined : <Button onClick={() => setEditing('new')}>Add department</Button>
          }
        />
      )}
      {data && data.items.length > 0 && (
        <div aria-busy={isFetching || undefined}>
          <Table caption="Departments" columns={columns} rows={data.items} rowKey={(d) => d.id} />
          <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
        </div>
      )}

      <DepartmentFormModal
        open={editing !== null}
        department={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}
